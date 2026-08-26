<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  OCRScanner (docs/architecture.md §6.1/§5.2, issue #26): captures an invoice frame —
  from the camera, a file/PDF upload, or a drag-and-drop — preprocesses it,
  runs client-side OCR with live progress, parses it against a fee schedule
  guessed from the recognised text (issues #183/#224 — see `detectProviderType`
  in `../utils/goae-parser`), and hands the resulting `ScanResult` to its
  parent for review. There is no manual pre-scan schedule selection; a wrong
  guess is corrected afterwards via the per-position Kategorie picker in
  `InvoiceReview`, same as any other misread field.

  Capture quality is judged before the expensive step, not after it: every
  rasterised page is measured (issue #279) and a frame that reads as blurred,
  dark or glare-struck raises a warning with concrete advice *before* OCR runs.
  The warning never blocks — "Trotzdem erkennen" always proceeds. During the
  live camera preview the same metrics drive an overlay that guides the shot as
  it is framed (issue #281).

  Privacy by design: the frame is recognised on-device and only the parsed
  text/metadata leaves this component — never the image — and nothing is uploaded
  here (docs/architecture.md §2.2, §8.1). A downscaled copy of each page is handed to the
  parent alongside the result so the review screen can show what was read; it
  lives in memory only, is never persisted, and the parent drops it when the
  invoice is saved or abandoned (docs/architecture.md §8.1).

  The capture/preprocess/recognise steps are injectable via `deps` so the flow
  is unit-testable without a real camera, worker or DOM.
-->
<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';

  import {
    capturePhoto as defaultCapturePhoto,
    grabPreviewFrame as defaultGrabPreviewFrame,
    requestCameraStream as defaultRequestCameraStream,
    stopStream as defaultStopStream,
    sortFilesByName,
    CaptureError,
  } from '../ocr/capture';
  import { preprocess as defaultPreprocess, QUALITY_METRIC_MAX_SIDE } from '../ocr/preprocess';
  import {
    assessImageQuality as defaultAssessQuality,
    failingPageNumbers,
    mergeQualityReports,
    QUALITY_OK_HINT,
    type QualityReport,
  } from '../ocr/quality';
  import { loadAllInvoicePages, recognizeInvoiceImage } from '../ocr/scan-ocr';
  import { buildScanResult, type ScanResult } from '../ocr/scan-flow';
  import {
    buildScanPreview,
    createPagePreview,
    PREVIEW_MAX_PAGES,
    type PageLineRange,
    type PagePreview,
    type ScanPreview,
  } from '../ocr/preview';
  import { SUPPORTED_INVOICE_SCHEDULES, loadFeeTable } from '../data/fee-tables';
  import { isScanImagePage, type OcrProgress, type OcrResult, type ScanPage } from '../ocr/types';
  import LoadingState from './LoadingState.svelte';
  import InvoicePagePreview from './InvoicePagePreview.svelte';
  import { Button } from './ui/button';
  import { Progress } from './ui/progress';
  import { Alert, AlertDescription, AlertTitle } from './ui/alert';
  import CameraIcon from '@lucide/svelte/icons/camera';
  import FileIcon from '@lucide/svelte/icons/file';
  import ScanIcon from '@lucide/svelte/icons/scan';
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
  import XIcon from '@lucide/svelte/icons/x';
  import { cn } from '../utils';

  /** Injection points so the scanner can run without a camera/worker (tests). */
  interface ScannerDeps {
    /** Expands the whole selection into one page list (multi-sheet invoices). */
    filesToPages: (files: File[]) => Promise<ScanPage[]>;
    preprocess: (image: ImageData) => ImageData;
    recognize: (
      image: ImageData,
      onProgress?: (progress: OcrProgress) => void,
    ) => Promise<OcrResult[]>;
    requestCameraStream: () => Promise<MediaStream>;
    stopStream: (stream: MediaStream) => void;
    capturePhoto: (stream: MediaStream, video: HTMLVideoElement) => Promise<ImageData>;
    /** Judges one frame's capture quality (issues #279/#281). */
    assessQuality: (image: ImageData) => QualityReport;
    /** Grabs a small preview frame for the live quality overlay (issue #281). */
    grabPreviewFrame: (video: HTMLVideoElement) => Promise<ImageData | null>;
  }

  /**
   * How often the live preview is sampled, in milliseconds (issue #281). At
   * ~2.5 samples a second the advice keeps up with the user repositioning the
   * page, while leaving the main thread free between ticks — each tick only
   * touches a 256 px copy, but the preview must never stutter.
   */
  const LIVE_SAMPLE_INTERVAL_MS = 400;

  let {
    onScanned,
    deps = {},
    autoFile = null,
  }: {
    /**
     * Called with the parsed result once a frame has been recognised, plus the
     * in-memory page previews the review screen draws the recognised lines on
     * (docs/architecture.md §6.1). The preview holds pixels — it is never persisted or
     * uploaded, and the caller must drop it when the scan is saved or abandoned.
     */
    onScanned: (result: ScanResult, preview: ScanPreview) => void;
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
  const filesToPages = deps.filesToPages ?? ((f: File[]) => loadAllInvoicePages(f));
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
  const capturePhoto =
    deps.capturePhoto ?? ((s: MediaStream, v: HTMLVideoElement) => defaultCapturePhoto(s, v));
  // svelte-ignore state_referenced_locally
  const assessQuality = deps.assessQuality ?? ((img: ImageData) => defaultAssessQuality(img));
  // svelte-ignore state_referenced_locally
  const grabPreviewFrame =
    deps.grabPreviewFrame ??
    ((v: HTMLVideoElement) => defaultGrabPreviewFrame(v, QUALITY_METRIC_MAX_SIDE));

  type Phase = 'idle' | 'camera' | 'processing' | 'quality-warning';
  let phase = $state<Phase>('idle');
  let progress = $state<OcrProgress | null>(null);
  let error = $state<string | null>(null);
  let stream: MediaStream | null = null;
  let video = $state<HTMLVideoElement | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);
  let dragDepth = $state(0);
  const isDragging = $derived(dragDepth > 0);

  /** Pages parked by the quality gate, awaiting the user's call (issue #279). */
  let pendingPages: ScanPage[] = [];
  /** Previews of {@link pendingPages}, so the warning can show the frame it faults. */
  let pendingPreviews = $state<PagePreview[]>([]);
  let pendingQuality = $state<QualityReport | null>(null);
  /** 1-based numbers of the parked pages that failed, so the warning can name them. */
  let pendingFailingPages = $state<number[]>([]);
  /** How many image pages were judged — the warning only names a sheet when >1. */
  let pendingPageCount = $state(0);
  /** Which entry point produced {@link pendingPages} — drives the retake action. */
  let pendingSource = $state<'camera' | 'file'>('file');

  /**
   * Sheets shot in the current camera session, awaiting "Fertig". Full-resolution
   * frames, so they are dropped on cancel/unmount as well as after recognition.
   * The array itself is not reactive (the frames are heavy and never rendered);
   * {@link capturedCount} drives the UI.
   */
  let capturedPages: ScanPage[] = [];
  let capturedCount = $state(0);

  /** Latest live verdict on the camera preview, or null before the first tick. */
  let liveQuality = $state<QualityReport | null>(null);
  /** Cancels the preview sampling loop; bumped on every teardown. */
  let sampleToken = 0;

  /** The single line the live overlay shows: the root cause, or the all-clear. */
  const liveHint = $derived(
    liveQuality === null ? null : (liveQuality.issues[0]?.liveHint ?? QUALITY_OK_HINT),
  );

  function messageFor(err: unknown): string {
    if (err instanceof CaptureError) return err.message;
    if (err instanceof Error) return err.message;
    return 'Die Rechnung konnte nicht verarbeitet werden.';
  }

  /**
   * Preprocess → OCR → parse one or more pages, then surface the result. A
   * page already carrying text-layer lines (PDF, issue #278) skips
   * preprocessing and OCR entirely; an image page still runs through both.
   * For multi-page documents every page's lines are recognised/read in order
   * and concatenated before parsing, so the full document is treated as one
   * invoice. Frames are discarded as soon as recognition finishes
   * (Datenminimierung §8.1).
   */
  /**
   * Preview snapshots of the image pages, in page order, built by
   * {@link processPages} *before* recognition — `recognize` transfers the pixel
   * buffer to the worker, so a copy taken afterwards may already be detached.
   * Shared by the quality warning (which shows the frame it is judging) and the
   * review screen (which draws the recognised lines on it).
   */
  async function runPages(pages: ScanPage[], previews: PagePreview[]): Promise<void> {
    phase = 'processing';
    error = null;
    progress = { phase: 'recognize', ratio: null, message: 'Bild wird vorverarbeitet …' };
    try {
      const tables = await Promise.all(SUPPORTED_INVOICE_SCHEDULES.map(loadFeeTable));
      const allResults: OcrResult[] = [];
      const ranges: PageLineRange[] = [];
      let imagePage = 0;
      for (const page of pages) {
        if (page.kind === 'text') {
          // A text-layer page has no image, so it gets no preview — and
          // deliberately no range either, so its lines are attributed to no page
          // rather than bleeding into the previous one.
          allResults.push(...page.lines);
          continue;
        }
        const preview = previews[imagePage];
        imagePage += 1;
        const start = allResults.length;
        const prepared = preprocess(page.image);
        const results = await recognize(prepared, (p) => (progress = p));
        allResults.push(...results);
        if (preview) ranges.push({ start, end: allResults.length });
      }
      onScanned(
        buildScanResult(allResults, tables),
        buildScanPreview(previews, allResults, ranges),
      );
      phase = 'idle';
      progress = null;
    } catch (err) {
      error = messageFor(err);
      phase = 'idle';
      progress = null;
    }
  }

  /**
   * The capture-quality gate (issue #279). Judges every page that will actually
   * be recognised — pages read from a PDF text layer have no image to fault —
   * and, when any of them looks unusable, parks the document and asks first
   * instead of burning an OCR run on it.
   *
   * Sitting here rather than inside {@link runPages} makes the check
   * source-agnostic for free: camera shots, uploaded photos and rasterised
   * scan-PDF pages all arrive through this one funnel.
   */
  async function processPages(pages: ScanPage[], source: 'camera' | 'file'): Promise<void> {
    const imagePages = pages.filter(isScanImagePage);
    const reports = imagePages.map((page) => assessQuality(page.image));
    // Snapshot every image page up front, while the buffers are still intact.
    const previews = imagePages
      .slice(0, PREVIEW_MAX_PAGES)
      .map((page) => createPagePreview(page.image));
    const verdict = mergeQualityReports(reports);
    if (!verdict.ok) {
      pendingPages = pages;
      pendingPreviews = previews;
      pendingQuality = verdict;
      pendingFailingPages = failingPageNumbers(reports);
      pendingPageCount = reports.length;
      pendingSource = source;
      error = null;
      phase = 'quality-warning';
      return;
    }
    await runPages(pages, previews);
  }

  /** "Trotzdem erkennen": the warning is advice, never a wall. */
  async function confirmQuality(): Promise<void> {
    const pages = pendingPages;
    const previews = pendingPreviews;
    pendingPages = [];
    pendingPreviews = [];
    pendingQuality = null;
    pendingFailingPages = [];
    pendingPageCount = 0;
    await runPages(pages, previews);
  }

  /** Discard the parked pages and offer the same entry point again. */
  async function retakeQuality(): Promise<void> {
    pendingPages = [];
    pendingPreviews = [];
    pendingQuality = null;
    pendingFailingPages = [];
    pendingPageCount = 0;
    phase = 'idle';
    if (pendingSource === 'camera') {
      await startCamera();
      return;
    }
    // The file input only exists in the idle branch — wait for it to render
    // again before reaching for it.
    await tick();
    fileInput?.click();
  }

  async function handleFiles(files: File[]): Promise<void> {
    if (files.length === 0) return;
    try {
      const pages = await filesToPages(files);
      await processPages(pages, 'file');
    } catch (err) {
      error = messageFor(err);
    }
  }

  async function onFileChange(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    // Reset so re-selecting the same file fires `change` again.
    input.value = '';
    // A file picker's FileList order is browser-defined, so sort it — otherwise
    // `seite-10.jpg` can land before `seite-2.jpg`.
    await handleFiles(sortFilesByName(files));
  }

  // Web Share Target (issue #158): scan a caller-supplied file straight away,
  // as if the user had just picked it from the file dialog.
  onMount(() => {
    if (autoFile) void handleFiles([autoFile]);
  });

  // Drop zone (issue #224). `dragDepth` counts nested enter/leave pairs so the
  // highlight doesn't flicker off while the pointer crosses a child element.
  function onDropzoneClick(): void {
    fileInput?.click();
  }

  function onDragEnter(event: DragEvent): void {
    event.preventDefault();
    dragDepth += 1;
  }

  function onDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  function onDragLeave(event: DragEvent): void {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
  }

  async function onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    dragDepth = 0;
    // Drop order is kept as-is: unlike a file picker's arbitrary FileList, the
    // order the user dropped files in is a choice.
    await handleFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  /**
   * Samples the preview a few times a second and publishes a live verdict
   * (issue #281), so the user can fix a dark or shaky shot while framing it
   * rather than discovering the problem after the OCR run.
   *
   * `sampleToken` is the cancellation handle: {@link teardownCamera} bumps it,
   * which retires any loop still in flight — a sample must never outlive the
   * preview it belongs to (the camera is released the moment the user leaves).
   */
  function startQualitySampling(): void {
    sampleToken += 1;
    const token = sampleToken;
    const tickOnce = async (): Promise<void> => {
      if (token !== sampleToken || !video) return;
      try {
        const frame = await grabPreviewFrame(video);
        if (token !== sampleToken) return;
        if (frame) liveQuality = assessQuality(frame);
      } catch {
        // A dropped sample is not worth surfacing — the next tick retries.
      }
      if (token !== sampleToken) return;
      setTimeout(() => void tickOnce(), LIVE_SAMPLE_INTERVAL_MS);
    };
    void tickOnce();
  }

  async function startCamera(): Promise<void> {
    error = null;
    liveQuality = null;
    capturedPages = [];
    capturedCount = 0;
    try {
      stream = await requestCameraStream();
      phase = 'camera';
      // Wait for the <video> to render, then attach the stream.
      await tick();
      if (video && stream) {
        video.srcObject = stream;
        // `play()` returns a promise per spec, but not in every environment
        // (jsdom hands back `undefined`) — optional-chain it so a missing
        // promise can't take the preview, and the sampling below, down with it.
        void video.play()?.catch(() => undefined);
        startQualitySampling();
      }
    } catch (err) {
      error = messageFor(err);
    }
  }

  function teardownCamera(): void {
    // Retire the sampling loop before the stream goes away.
    sampleToken += 1;
    liveQuality = null;
    if (stream) stopStream(stream);
    stream = null;
    if (video) video.srcObject = null;
  }

  function cancelCamera(): void {
    // Abandon every sheet shot in this session, not just the preview.
    capturedPages = [];
    capturedCount = 0;
    teardownCamera();
    phase = 'idle';
  }

  /**
   * Shutter: adds one sheet and **keeps the camera open**, so a multi-page paper
   * invoice can be shot in one go. Recognition starts only on "Fertig".
   */
  async function capture(): Promise<void> {
    if (!video || !stream) return;
    const activeStream = stream;
    try {
      const image = await capturePhoto(activeStream, video);
      capturedPages.push({ kind: 'image', image });
      capturedCount = capturedPages.length;
    } catch (err) {
      // Never leave the camera running on a failed capture.
      teardownCamera();
      phase = 'idle';
      error = messageFor(err);
    }
  }

  /** "Fertig – erkennen": close the camera and run the sheets shot so far. */
  async function finishCamera(): Promise<void> {
    const pages = capturedPages;
    capturedPages = [];
    capturedCount = 0;
    teardownCamera();
    if (pages.length === 0) {
      phase = 'idle';
      return;
    }
    await processPages(pages, 'camera');
  }

  // Release the camera if the component is torn down (navigate-away) before the
  // user captures or cancels — the LED must not stay on (privacy, §8.1) — and drop
  // any sheets shot but not yet recognised, so frames never outlive the view.
  onDestroy(() => {
    capturedPages = [];
    capturedCount = 0;
    teardownCamera();
  });
</script>

<div class="flex flex-col gap-3">
  {#if phase === 'processing'}
    <div class="flex flex-col gap-2">
      <LoadingState label={progress?.message ?? 'Rechnung wird erkannt …'} />
      {#if progress?.ratio != null}
        <Progress value={Math.round(progress.ratio * 100)} max={100} />
      {/if}
    </div>
  {:else if phase === 'quality-warning' && pendingQuality}
    <!-- Pre-OCR quality warning (issue #279). Advisory, not a gate: the primary
    action is still to recognise the frame the user already captured. -->
    <div class="flex flex-col gap-3">
      <Alert>
        <TriangleAlertIcon />
        <AlertTitle>Die Vorlage könnte für die Erkennung zu schlecht sein</AlertTitle>
        <AlertDescription>
          <ul class="list-disc space-y-1 pl-4">
            {#each pendingQuality.issues as issue (issue.code)}
              <li>{issue.hint}</li>
            {/each}
          </ul>
          <!-- Name the offending sheet: on a multi-page document, unqualified
          advice leaves the user re-shooting all of them. -->
          {#if pendingPageCount > 1 && pendingFailingPages.length > 0}
            <p class="mt-2">
              Betrifft {pendingFailingPages.length === 1 ? 'Seite' : 'Seiten'}
              {pendingFailingPages.join(', ')} von {pendingPageCount}.
            </p>
          {/if}
        </AlertDescription>
      </Alert>
      <!-- Show the frame being faulted: "zu dunkel" is far easier to act on
      when the shot is on screen next to the advice. -->
      {#if pendingPreviews.length > 0}
        <InvoicePagePreview preview={{ pages: pendingPreviews, lines: [] }} />
      {/if}
      <div class="flex flex-wrap gap-2">
        <Button type="button" variant="default" onclick={() => void confirmQuality()}>
          Trotzdem erkennen
        </Button>
        <Button type="button" variant="outline" onclick={() => void retakeQuality()}>
          {pendingSource === 'camera' ? 'Neu aufnehmen' : 'Andere Dateien wählen'}
        </Button>
      </div>
    </div>
  {:else if phase === 'camera'}
    <!-- Fullscreen overlay (issue: the small inline preview made the round
    bottom-nav "Erfassen" FAB look like the shutter, causing mistaps). Covers
    the fixed header/bottom nav (both z-50) so the shutter below is the only
    round control on screen. -->
    <div class="fixed inset-0 z-[60] flex flex-col bg-black">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onclick={cancelCamera}
        class="absolute top-3 right-3 z-10 text-white hover:bg-white/10 hover:text-white"
      >
        <XIcon class="size-5" />
        <span class="sr-only">Abbrechen</span>
      </Button>
      <video
        bind:this={video}
        playsinline
        aria-label="Kameravorschau"
        class="min-h-0 w-full flex-1 object-cover"
      ></video>
      <!-- Live capture advice (issue #281). A polite live region so the hint is
      announced as it changes without interrupting; deliberately text-only, as a
      progressbar-style meter here would need its own accessible name. -->
      <div
        role="status"
        aria-live="polite"
        class="pointer-events-none flex min-h-9 items-center justify-center px-4"
      >
        {#if liveHint}
          <span
            class={cn(
              'rounded-full px-3 py-1.5 text-sm font-medium text-white',
              liveQuality?.ok ? 'bg-emerald-600/80' : 'bg-black/70',
            )}
          >
            {liveHint}
          </span>
        {/if}
      </div>
      <!-- Multi-sheet capture: the shutter adds a page and keeps the camera
      open, so a two-page invoice needs no second trip through the dropzone.
      Recognition starts on "Fertig". The count is a live region so the
      confirmation is announced without stealing focus from the shutter. -->
      <div class="grid grid-cols-3 items-center gap-2 px-4 py-6">
        <span class="text-sm font-medium text-white" role="status" aria-live="polite">
          {#if capturedCount > 0}
            {capturedCount}
            {capturedCount === 1 ? 'Seite' : 'Seiten'} aufgenommen
          {/if}
        </span>
        <div class="flex justify-center">
          <Button
            type="button"
            variant="ghost"
            onclick={capture}
            aria-label={capturedCount > 0 ? 'Weitere Seite aufnehmen' : 'Aufnehmen'}
            class="size-16 shrink-0 rounded-full border-4 border-white bg-white/10 p-0 hover:bg-white/20"
          >
            <span class="size-12 rounded-full bg-white"></span>
          </Button>
        </div>
        <div class="flex justify-end">
          {#if capturedCount > 0}
            <Button type="button" variant="secondary" onclick={() => void finishCamera()}>
              Fertig – erkennen
            </Button>
          {/if}
        </div>
      </div>
    </div>
  {:else}
    <div class="flex flex-col gap-3">
      <div
        role="presentation"
        onclick={onDropzoneClick}
        ondragenter={onDragEnter}
        ondragover={onDragOver}
        ondragleave={onDragLeave}
        ondrop={onDrop}
        class={cn(
          'flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-7 text-center transition-colors',
          isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40',
        )}
      >
        <div
          class={cn(
            'flex size-11 items-center justify-center rounded-full transition-colors',
            isDragging ? 'bg-primary text-primary-foreground' : 'bg-accent text-primary',
          )}
        >
          <ScanIcon class="size-5.5" />
        </div>
        <p class="text-sm font-semibold">Rechnung hierher ziehen oder auswählen</p>
        <p class="text-muted-foreground -mt-1.5 text-xs">
          Fotos, Bilder oder PDFs – mehrere Seiten möglich
        </p>
        <div class="flex flex-wrap justify-center gap-2">
          <Button
            type="button"
            variant="default"
            onclick={(e: MouseEvent) => {
              e.stopPropagation();
              void startCamera();
            }}
          >
            <CameraIcon class="mr-1.5 size-3.5" />
            Rechnung fotografieren
          </Button>
          <Button
            type="button"
            variant="outline"
            onclick={(e: MouseEvent) => {
              e.stopPropagation();
              fileInput?.click();
            }}
          >
            <FileIcon class="mr-1.5 size-3.5" />
            Dateien/PDF wählen
          </Button>
        </div>
        <!-- `multiple`: a multi-sheet paper invoice is often several photos, and
        they belong to one invoice. Mixed selections (photos + a PDF) flatten
        into one page sequence. -->
        <input
          bind:this={fileInput}
          type="file"
          accept="image/*,application/pdf"
          multiple
          class="sr-only"
          aria-label="Rechnungsdateien (Bilder oder PDFs)"
          onchange={onFileChange}
        />
      </div>
      <p class="text-muted-foreground text-sm">
        Fotos, Bilder oder PDFs – mehrseitige Rechnungen können als mehrere Dateien ausgewählt oder
        in Folge fotografiert werden. Die Erkennung läuft vollständig auf diesem Gerät; das Bild
        verlässt es nie. Es bleibt nur zur Prüfung sichtbar und wird beim Speichern verworfen.
      </p>
    </div>
  {/if}

  {#if error}
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  {/if}
</div>
