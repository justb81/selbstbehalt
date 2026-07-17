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
}

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
 * devices that support it. Falls back to {@link captureVideoFrame} when
 * `ImageCapture` is unavailable or the still capture fails for any reason
 * (issue #280) — the camera flow must never dead-end just because the richer
 * API isn't there.
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
      // Fall through to the video-frame grab below.
    }
  }
  return captureVideoFrame(video, deps);
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
