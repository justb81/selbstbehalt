<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  OCRScanner (docs/design.md §4.1/§6.2, issue #26): captures an invoice frame —
  from the camera or a file/PDF upload — preprocesses it, runs client-side OCR
  with live progress, parses it against the chosen fee schedule, and hands the
  resulting `ScanResult` to its parent for review.

  Privacy by design: the frame is recognised on-device and discarded as soon as
  OCR finishes; only the parsed text/metadata leaves this component (never the
  image), and nothing is uploaded here (docs/design.md §1.3, §8).

  The capture/preprocess/recognise steps are injectable via `deps` so the flow
  is unit-testable without a real camera, worker or DOM.
-->
<script lang="ts">
  import { tick } from 'svelte';

  import {
    captureVideoFrame as defaultCaptureVideoFrame,
    requestCameraStream as defaultRequestCameraStream,
    stopStream as defaultStopStream,
    CaptureError,
  } from '$lib/ocr/capture';
  import { preprocess as defaultPreprocess } from '$lib/ocr/preprocess';
  import { loadInvoiceImage, recognizeInvoiceImage } from '$lib/ocr/scan-ocr';
  import { buildScanResult, type ScanResult } from '$lib/ocr/scan-flow';
  import { FEE_SCHEDULE_IDS } from '$lib/data/fee-tables';
  import type { FeeScheduleId } from '$lib/data/fee-schedule';
  import type { OcrProgress, OcrResult } from '$lib/ocr/types';
  import LoadingState from './LoadingState.svelte';

  /** Injection points so the scanner can run without a camera/worker (tests). */
  interface ScannerDeps {
    fileToImageData: (file: File) => Promise<ImageData>;
    preprocess: (image: ImageData) => ImageData;
    recognize: (
      image: ImageData,
      onProgress?: (progress: OcrProgress) => void,
    ) => Promise<OcrResult[]>;
    requestCameraStream: () => Promise<MediaStream>;
    stopStream: (stream: MediaStream) => void;
    captureVideoFrame: (video: HTMLVideoElement) => Promise<ImageData>;
  }

  let {
    schedule = $bindable<FeeScheduleId>('GOÄ'),
    onScanned,
    deps = {},
  }: {
    /** Fee schedule the captured invoice is parsed against. */
    schedule?: FeeScheduleId;
    /** Called with the parsed result once a frame has been recognised. */
    onScanned: (result: ScanResult) => void;
    deps?: Partial<ScannerDeps>;
  } = $props();

  // `deps` is injected once (tests) and never changes; capturing the initial
  // value here is intentional, so silence the seed-once reactivity warning.
  // svelte-ignore state_referenced_locally
  const fileToImageData = deps.fileToImageData ?? ((f: File) => loadInvoiceImage(f));
  // svelte-ignore state_referenced_locally
  const preprocess =
    deps.preprocess ?? ((img: ImageData) => defaultPreprocess(img, { contrast: 1.2 }));
  // svelte-ignore state_referenced_locally
  const recognize = deps.recognize ?? recognizeInvoiceImage;
  // svelte-ignore state_referenced_locally
  const requestCameraStream = deps.requestCameraStream ?? (() => defaultRequestCameraStream());
  // svelte-ignore state_referenced_locally
  const stopStream = deps.stopStream ?? defaultStopStream;
  // svelte-ignore state_referenced_locally
  const captureVideoFrame =
    deps.captureVideoFrame ?? ((v: HTMLVideoElement) => defaultCaptureVideoFrame(v));

  type Phase = 'idle' | 'camera' | 'processing';
  let phase = $state<Phase>('idle');
  let progress = $state<OcrProgress | null>(null);
  let error = $state<string | null>(null);
  let stream: MediaStream | null = null;
  let video = $state<HTMLVideoElement | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);

  function messageFor(err: unknown): string {
    if (err instanceof CaptureError) return err.message;
    if (err instanceof Error) return err.message;
    return 'Die Rechnung konnte nicht verarbeitet werden.';
  }

  /** Preprocess → OCR → parse a captured frame, then surface the result. */
  async function processImage(image: ImageData): Promise<void> {
    phase = 'processing';
    error = null;
    progress = { phase: 'recognize', ratio: null, message: 'Bild wird vorverarbeitet …' };
    try {
      const prepared = preprocess(image);
      const results = await recognize(prepared, (p) => (progress = p));
      // The frame is no longer referenced past this point — only text/metadata
      // continues through the flow (datenminimierung, §8.2).
      onScanned(buildScanResult(results, schedule));
      phase = 'idle';
      progress = null;
    } catch (err) {
      error = messageFor(err);
      phase = 'idle';
      progress = null;
    }
  }

  async function onFileChange(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // Reset so re-selecting the same file fires `change` again.
    input.value = '';
    if (!file) return;
    try {
      const image = await fileToImageData(file);
      await processImage(image);
    } catch (err) {
      error = messageFor(err);
    }
  }

  async function startCamera(): Promise<void> {
    error = null;
    try {
      stream = await requestCameraStream();
      phase = 'camera';
      // Wait for the <video> to render, then attach the stream.
      await tick();
      if (video && stream) {
        video.srcObject = stream;
        void video.play().catch(() => undefined);
      }
    } catch (err) {
      error = messageFor(err);
    }
  }

  function teardownCamera(): void {
    if (stream) stopStream(stream);
    stream = null;
    if (video) video.srcObject = null;
  }

  function cancelCamera(): void {
    teardownCamera();
    phase = 'idle';
  }

  async function capture(): Promise<void> {
    if (!video) return;
    try {
      const image = await captureVideoFrame(video);
      teardownCamera();
      await processImage(image);
    } catch (err) {
      error = messageFor(err);
    }
  }
</script>

<div class="scanner">
  {#if phase === 'processing'}
    <div class="processing">
      <LoadingState label={progress?.message ?? 'Rechnung wird erkannt …'} />
      {#if progress?.ratio != null}
        <progress max="1" value={progress.ratio}></progress>
      {/if}
    </div>
  {:else if phase === 'camera'}
    <div class="camera">
      <video bind:this={video} playsinline aria-label="Kameravorschau"></video>
      <div class="actions">
        <button type="button" class="primary" onclick={capture}>Aufnehmen</button>
        <button type="button" onclick={cancelCamera}>Abbrechen</button>
      </div>
    </div>
  {:else}
    <div class="capture">
      <label class="field">
        <span>Gebührenordnung</span>
        <select bind:value={schedule} aria-label="Gebührenordnung">
          {#each FEE_SCHEDULE_IDS as id (id)}
            <option value={id}>{id}</option>
          {/each}
        </select>
      </label>

      <div class="actions">
        <button type="button" class="primary" onclick={startCamera}>Kamera öffnen</button>
        <button type="button" onclick={() => fileInput?.click()}>Datei wählen</button>
      </div>
      <input
        bind:this={fileInput}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        class="visually-hidden"
        aria-label="Rechnungsdatei (Bild oder PDF)"
        onchange={onFileChange}
      />
      <p class="hint">
        Foto, Bild oder PDF. Die Erkennung läuft vollständig auf diesem Gerät; das Bild verlässt es
        nie und wird nach der Erkennung verworfen.
      </p>
    </div>
  {/if}

  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
</div>

<style>
  .scanner {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    max-width: 12rem;
  }

  select {
    padding: var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font: inherit;
    background: var(--color-surface);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  button {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
  }

  button.primary {
    border-color: transparent;
    background: var(--color-primary);
    color: var(--color-primary-contrast);
  }

  button.primary:hover {
    background: var(--color-primary-strong);
  }

  .hint {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }

  .camera video {
    width: 100%;
    max-height: 60vh;
    border-radius: var(--radius-md);
    background: #000;
  }

  .processing {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  progress {
    width: 100%;
  }

  .error {
    margin: 0;
    color: var(--color-danger);
    font-size: var(--font-size-sm);
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
</style>
