// SPDX-License-Identifier: Apache-2.0
/**
 * Image capture for the OCR pipeline (docs/design.md §4.1, §2.1, issue #25).
 *
 * Acquires an invoice frame either from the camera (`getUserMedia`, rear camera
 * preferred) or from a file/PDF upload, and normalises it to an {@link ImageData}
 * for preprocessing (#25) and the OCR worker (#24). Permission and capability
 * failures surface as typed {@link CaptureError}s so the UI can react precisely.
 *
 * **Privacy:** frames are decoded and rasterised entirely on-device; no upload
 * ever happens here (docs/design.md §1.3, §8). Canvas/codec/PDF dependencies are
 * injectable, keeping the control flow unit-testable without a real DOM.
 */
import {
  extractOrRenderAllPdfPages as defaultExtractOrRenderAllPdfPages,
  renderPdfPage as defaultRenderPdfPage,
} from './pdf';
import { pickSharpestFrame } from './quality';
import type { ScanPage } from './types';

/** Stable reasons a capture can fail. */
export type CaptureErrorCode =
  | 'unsupported'
  | 'permission_denied'
  | 'no_camera'
  | 'camera_error'
  | 'unsupported_file'
  | 'decode_failed';

/** Error raised by the capture helpers, carrying a stable {@link CaptureErrorCode}. */
export class CaptureError extends Error {
  constructor(
    readonly code: CaptureErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CaptureError';
  }
}

/** Injection points so the capture flow can be tested without a real DOM. */
export interface CaptureDeps {
  /** Rasterises a drawable source into {@link ImageData}. */
  toImageData?: (
    source: CanvasImageSource,
    width: number,
    height: number,
  ) => Promise<ImageData> | ImageData;
  /** Decodes an image blob (defaults to `createImageBitmap`). */
  decode?: (blob: Blob) => Promise<ImageBitmap>;
  /** Renders a single PDF page to {@link ImageData} (defaults to {@link renderPdfPage}). */
  renderPdfPage?: (file: Blob, pageNumber: number) => Promise<ImageData>;
  /**
   * Reads every PDF page, preferring each page's text layer and falling back
   * to rasterisation per page (defaults to {@link extractOrRenderAllPdfPages}).
   */
  extractOrRenderAllPdfPages?: (file: Blob) => Promise<ScanPage[]>;
  /**
   * Takes a full-resolution still photo off a live camera track (defaults to
   * `ImageCapture.takePhoto()`, issue #280).
   */
  takePhoto?: (track: MediaStreamTrack) => Promise<Blob>;
  /**
   * Waits between the frames of a best-frame burst (issue #281). Injectable so
   * {@link captureBestVideoFrame} runs instantly in tests.
   */
  sleep?: (ms: number) => Promise<void>;
}

/** Frames grabbed in a best-frame burst when `ImageCapture` is unavailable. */
export const BEST_FRAME_SAMPLE_COUNT = 3;

/** Delay between the frames of a best-frame burst, in milliseconds. */
export const BEST_FRAME_INTERVAL_MS = 80;

/**
 * Default camera constraints: rear-facing video at a high still-image
 * resolution. `ideal` only steers the browser's pick — it never fails the
 * request when a device can't reach it — but without it many devices default
 * to a 640×480/720p video mode far below a real camera photo (issue #280).
 */
export const REAR_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
  audio: false,
};

function mapMediaError(err: unknown): CaptureError {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new CaptureError('permission_denied', 'Kamerazugriff wurde abgelehnt.');
  }
  if (
    name === 'NotFoundError' ||
    name === 'OverconstrainedError' ||
    name === 'DevicesNotFoundError'
  ) {
    return new CaptureError('no_camera', 'Keine geeignete Kamera gefunden.');
  }
  const message = err instanceof Error ? err.message : 'Kamera konnte nicht gestartet werden.';
  return new CaptureError('camera_error', message);
}

/**
 * Opens a camera stream (rear camera preferred). Throws a {@link CaptureError}
 * when `getUserMedia` is unsupported, denied, or no camera is available.
 */
export async function requestCameraStream(
  constraints: MediaStreamConstraints = REAR_CAMERA_CONSTRAINTS,
): Promise<MediaStream> {
  const media = (globalThis as { navigator?: Navigator }).navigator?.mediaDevices;
  if (!media?.getUserMedia) {
    throw new CaptureError('unsupported', 'Diese Umgebung unterstützt keine Kameraaufnahme.');
  }
  try {
    return await media.getUserMedia(constraints);
  } catch (err) {
    throw mapMediaError(err);
  }
}

/** Stops every track of a stream — call this to release the camera. */
export function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/** Default rasteriser: draw onto a canvas and read back its pixels. */
function defaultToImageData(source: CanvasImageSource, width: number, height: number): ImageData {
  const canvas: HTMLCanvasElement | OffscreenCanvas =
    typeof document !== 'undefined'
      ? Object.assign(document.createElement('canvas'), { width, height })
      : new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d') as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new CaptureError('decode_failed', 'Kein 2D-Canvas-Kontext verfügbar.');
  context.drawImage(source, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

function defaultDecode(blob: Blob): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== 'function') {
    throw new CaptureError('unsupported', 'Bilddekodierung wird nicht unterstützt.');
  }
  return createImageBitmap(blob);
}

/**
 * Captures the current frame of a playing `<video>` element as {@link ImageData}.
 * Throws if the video has no dimensions yet (stream not ready).
 */
export async function captureVideoFrame(
  video: HTMLVideoElement,
  deps: CaptureDeps = {},
): Promise<ImageData> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) {
    throw new CaptureError('camera_error', 'Kamerabild ist noch nicht bereit.');
  }
  const toImageData = deps.toImageData ?? defaultToImageData;
  return toImageData(video, width, height);
}

/**
 * Grabs the current preview frame already scaled down to `maxSide` on its
 * longest edge (issue #281). Rasterising small straight away — rather than
 * reading a full 1080p frame and shrinking it afterwards — is what keeps the
 * live quality sampling cheap enough to run a few times a second without the
 * preview stuttering.
 *
 * Returns `null` while the stream has no dimensions yet, so a sampling loop
 * that starts before the camera is ready can simply skip the tick instead of
 * treating it as an error.
 */
export async function grabPreviewFrame(
  video: HTMLVideoElement,
  maxSide: number,
  deps: CaptureDeps = {},
): Promise<ImageData | null> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const toImageData = deps.toImageData ?? defaultToImageData;
  return toImageData(video, targetWidth, targetHeight);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Grabs a short burst of video frames and keeps the sharpest (issue #281).
 * Hand shake blurs individual frames unpredictably, so sampling a few and
 * picking the best mitigates it without asking the user to do anything.
 *
 * This is the fallback path only — {@link capturePhoto} prefers
 * `ImageCapture.takePhoto()`, whose full-sensor-resolution still beats any
 * video frame no matter how sharp (#280).
 */
export async function captureBestVideoFrame(
  video: HTMLVideoElement,
  deps: CaptureDeps = {},
  options: { count?: number; intervalMs?: number } = {},
): Promise<ImageData> {
  const { count = BEST_FRAME_SAMPLE_COUNT, intervalMs = BEST_FRAME_INTERVAL_MS } = options;
  const sleep = deps.sleep ?? defaultSleep;
  const frames: ImageData[] = [];
  for (let i = 0; i < Math.max(1, count); i++) {
    if (i > 0) await sleep(intervalMs);
    frames.push(await captureVideoFrame(video, deps));
  }
  // `frames` is non-empty (the first grab either succeeded or threw), so
  // `pickSharpestFrame` cannot return null here.
  return pickSharpestFrame(frames) ?? frames[0]!;
}

/** `ImageCapture` isn't in every target yet; look it up dynamically. */
function defaultTakePhoto(track: MediaStreamTrack): Promise<Blob> {
  const ImageCaptureCtor = (globalThis as { ImageCapture?: typeof ImageCapture }).ImageCapture;
  if (!ImageCaptureCtor) {
    return Promise.reject(new CaptureError('unsupported', 'ImageCapture wird nicht unterstützt.'));
  }
  return new ImageCaptureCtor(track).takePhoto();
}

/**
 * Captures a full-resolution still photo from a live camera stream. Prefers
 * `ImageCapture.takePhoto()`, which grabs a still image at the sensor's native
 * resolution instead of a `<video>` frame, and so is markedly sharper on
 * devices that support it. Falls back to {@link captureBestVideoFrame} when
 * `ImageCapture` is unavailable or the still capture fails for any reason
 * (issue #280) — the camera flow must never dead-end just because the richer
 * API isn't there.
 *
 * Best-frame selection (issue #281) applies to the fallback only, and
 * deliberately so: `takePhoto()` already returns the better image, so re-picking
 * among video frames when it is available would trade resolution for nothing.
 */
export async function capturePhoto(
  stream: MediaStream,
  video: HTMLVideoElement,
  deps: CaptureDeps = {},
): Promise<ImageData> {
  const track = stream.getVideoTracks()[0];
  if (track) {
    try {
      const takePhoto = deps.takePhoto ?? defaultTakePhoto;
      const blob = await takePhoto(track);
      const decode = deps.decode ?? defaultDecode;
      const toImageData = deps.toImageData ?? defaultToImageData;
      const bitmap = await decode(blob);
      try {
        return await toImageData(bitmap, bitmap.width, bitmap.height);
      } finally {
        bitmap.close?.();
      }
    } catch {
      // Fall through to the video-frame burst below.
    }
  }
  return captureBestVideoFrame(video, deps);
}

/**
 * Loads every page of a user-selected file as {@link ScanPage}s: a PDF page
 * carries its text-layer lines when usable and only falls back to a
 * rasterised image per page otherwise (issue #278 — see
 * {@link extractOrRenderAllPdfPages}); a plain image file produces a single
 * `{ kind: 'image' }` entry. This is the multi-page counterpart of
 * {@link fileToImageData} — prefer it when the full document must be scanned
 * (e.g. a two-page invoice).
 */
export async function fileToAllPages(file: File, deps: CaptureDeps = {}): Promise<ScanPage[]> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf) {
    const extractOrRenderAll = deps.extractOrRenderAllPdfPages ?? defaultExtractOrRenderAllPdfPages;
    return extractOrRenderAll(file);
  }
  return [{ kind: 'image', image: await fileToImageData(file, {}, deps) }];
}

/**
 * Collator that orders `seite-2.jpg` before `seite-10.jpg`. A plain
 * lexicographic sort puts "10" first, which silently scrambles the pages of a
 * multi-sheet invoice.
 */
const FILENAME_COLLATOR = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

/**
 * Loads every page of several user-selected files into one page list, so a
 * multi-sheet paper invoice photographed as separate images is scanned as *one*
 * invoice. Mixed selections work: two photos plus a PDF flatten into the
 * combined page sequence, in file order, each file expanded by
 * {@link fileToAllPages}.
 *
 * Files are **not** reordered here — page order is the caller's decision, since
 * only it knows whether the order was chosen (a drop sequence) or incidental (a
 * file picker's arbitrary `FileList` order). Callers that need name-based
 * ordering should apply {@link sortFilesByName} first.
 *
 * Pages are loaded sequentially rather than with `Promise.all`: each rasterised
 * page is a full-resolution RGBA buffer, and decoding a dozen at once is how a
 * mobile browser runs out of memory mid-scan.
 */
export async function filesToAllPages(
  files: readonly File[],
  deps: CaptureDeps = {},
): Promise<ScanPage[]> {
  const pages: ScanPage[] = [];
  for (const file of files) {
    pages.push(...(await fileToAllPages(file, deps)));
  }
  return pages;
}

/**
 * Orders files by filename, numerically — `seite-2` before `seite-10`. Use for a
 * file-picker selection, whose `FileList` order is browser-defined; leave a
 * drag-and-drop order alone, since that one the user chose.
 */
export function sortFilesByName(files: readonly File[]): File[] {
  return [...files].sort((a, b) => FILENAME_COLLATOR.compare(a.name, b.name));
}

/**
 * Loads a user-selected file into {@link ImageData}: PDFs are rendered (first
 * page by default), images are decoded and rasterised. Unknown types and decode
 * failures surface as {@link CaptureError}s.
 */
export async function fileToImageData(
  file: File,
  options: { pdfPage?: number } = {},
  deps: CaptureDeps = {},
): Promise<ImageData> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf) {
    const renderPdfPage = deps.renderPdfPage ?? defaultRenderPdfPage;
    return renderPdfPage(file, options.pdfPage ?? 1);
  }
  if (file.type && !file.type.startsWith('image/')) {
    throw new CaptureError('unsupported_file', `Nicht unterstützter Dateityp: ${file.type}`);
  }
  const decode = deps.decode ?? defaultDecode;
  const toImageData = deps.toImageData ?? defaultToImageData;
  let bitmap: ImageBitmap;
  try {
    bitmap = await decode(file);
  } catch (err) {
    if (err instanceof CaptureError) throw err;
    throw new CaptureError('decode_failed', 'Bild konnte nicht gelesen werden.');
  }
  try {
    return await toImageData(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close?.();
  }
}
