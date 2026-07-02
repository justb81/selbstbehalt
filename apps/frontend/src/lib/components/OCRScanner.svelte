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
  import { onDestroy, onMount, tick } from 'svelte';

  import {
    captureVideoFrame as defaultCaptureVideoFrame,
    requestCameraStream as defaultRequestCameraStream,
    stopStream as defaultStopStream,
    CaptureError,
  } from '$lib/ocr/capture';
  import { preprocess as defaultPreprocess } from '$lib/ocr/preprocess';
  import { loadAllInvoiceImages, recognizeInvoiceImage } from '$lib/ocr/scan-ocr';
  import { buildScanResult, type ScanResult } from '$lib/ocr/scan-flow';
  import { FEE_SCHEDULE_IDS, loadFeeTable } from '$lib/data/fee-tables';
  import type { FeeScheduleId } from '$lib/data/fee-schedule';
  import type { OcrProgress, OcrResult } from '$lib/ocr/types';
  import LoadingState from './LoadingState.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Progress } from '$lib/components/ui/progress';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';
  import { Label } from '$lib/components/ui/label';
  import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';

  /** Injection points so the scanner can run without a camera/worker (tests). */
  interface ScannerDeps {
    fileToImages: (file: File) => Promise<ImageData[]>;
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
    autoFile = null,
  }: {
    /** Fee schedule the captured invoice is parsed against. */
    schedule?: FeeScheduleId;
    /** Called with the parsed result once a frame has been recognised. */
    onScanned: (result: ScanResult) => void;
    deps?: Partial<ScannerDeps>;
    /**
     * A file supplied by the caller (e.g. a PWA share target, issue #158)
     * that is scanned immediately on mount, without user interaction.
     */
    autoFile?: File | null;
  } = $props();

  // `deps` is injected once (tests) and never changes; capturing the initial
  // value here is intentional, so silence the seed-once reactivity warning.
  // svelte-ignore state_referenced_locally
  const fileToImages = deps.fileToImages ?? ((f: File) => loadAllInvoiceImages(f));
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

  /**
   * Preprocess → OCR → parse one or more frames, then surface the result.
   * For multi-page PDFs each page is recognised in order and the results are
   * concatenated before parsing, so the full document is treated as one invoice.
   * Frames are discarded as soon as recognition finishes (Datenminimierung §8.2).
   */
  async function processImages(images: ImageData[]): Promise<void> {
    phase = 'processing';
    error = null;
    progress = { phase: 'recognize', ratio: null, message: 'Bild wird vorverarbeitet …' };
    try {
      const table = await loadFeeTable(schedule);
      const allResults: OcrResult[] = [];
      for (const image of images) {
        const prepared = preprocess(image);
        const results = await recognize(prepared, (p) => (progress = p));
        allResults.push(...results);
      }
      onScanned(buildScanResult(allResults, schedule, table));
      phase = 'idle';
      progress = null;
    } catch (err) {
      error = messageFor(err);
      phase = 'idle';
      progress = null;
    }
  }

  async function handleFile(file: File): Promise<void> {
    try {
      const images = await fileToImages(file);
      await processImages(images);
    } catch (err) {
      error = messageFor(err);
    }
  }

  async function onFileChange(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // Reset so re-selecting the same file fires `change` again.
    input.value = '';
    if (!file) return;
    await handleFile(file);
  }

  // Web Share Target (issue #158): scan a caller-supplied file straight away,
  // as if the user had just picked it from the file dialog.
  onMount(() => {
    if (autoFile) void handleFile(autoFile);
  });

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
      await processImages([image]);
    } catch (err) {
      // Never leave the camera running on a failed capture.
      teardownCamera();
      phase = 'idle';
      error = messageFor(err);
    }
  }

  // Release the camera if the component is torn down (navigate-away) before the
  // user captures or cancels — the LED must not stay on (privacy, §8).
  onDestroy(teardownCamera);
</script>

<div class="flex flex-col gap-3">
  {#if phase === 'processing'}
    <div class="flex flex-col gap-2">
      <LoadingState label={progress?.message ?? 'Rechnung wird erkannt …'} />
      {#if progress?.ratio != null}
        <Progress value={Math.round(progress.ratio * 100)} max={100} />
      {/if}
    </div>
  {:else if phase === 'camera'}
    <div class="flex flex-col gap-3">
      <video
        bind:this={video}
        playsinline
        aria-label="Kameravorschau"
        class="w-full max-h-[60vh] rounded-xl bg-black"
      ></video>
      <div class="flex flex-wrap gap-2">
        <Button type="button" variant="default" onclick={capture}>Aufnehmen</Button>
        <Button type="button" variant="outline" onclick={cancelCamera}>Abbrechen</Button>
      </div>
    </div>
  {:else}
    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-1.5 max-w-48">
        <Label for="fee-schedule-select">Gebührenordnung</Label>
        <Select
          type="single"
          value={schedule as string}
          onValueChange={(v: string) => {
            schedule = v as FeeScheduleId;
          }}
        >
          <SelectTrigger id="fee-schedule-select" aria-label="Gebührenordnung">
            {schedule}
          </SelectTrigger>
          <SelectContent>
            {#each FEE_SCHEDULE_IDS as id (id)}
              <SelectItem value={id} label={id} />
            {/each}
          </SelectContent>
        </Select>
      </div>

      <div class="flex flex-wrap gap-2">
        <Button type="button" variant="default" onclick={startCamera}>Kamera öffnen</Button>
        <Button type="button" variant="outline" onclick={() => fileInput?.click()}>
          Datei wählen
        </Button>
      </div>
      <input
        bind:this={fileInput}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        class="sr-only"
        aria-label="Rechnungsdatei (Bild oder PDF)"
        onchange={onFileChange}
      />
      <p class="text-muted-foreground text-sm">
        Foto, Bild oder PDF. Die Erkennung läuft vollständig auf diesem Gerät; das Bild verlässt es
        nie und wird nach der Erkennung verworfen.
      </p>
    </div>
  {/if}

  {#if error}
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  {/if}
</div>
