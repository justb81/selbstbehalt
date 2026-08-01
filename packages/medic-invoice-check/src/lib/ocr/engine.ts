// SPDX-License-Identifier: Apache-2.0
/**
 * PaddleOCR engine adapter (docs/design.md §4.2, issues #24/#27).
 *
 * Adapts the `ppu-paddle-ocr` (PP-OCRv6 on ONNX Runtime) binding to the
 * {@link OcrEngine} interface the worker drives. We use the package's **web**
 * entry (`ppu-paddle-ocr/web`), which runs in a Web Worker, accepts an
 * {@link ImageData} frame directly and selects WebGPU with an automatic WASM
 * fallback. The binding is heavy (ONNX Runtime + WASM/opencv) and resolves its
 * own assets, so it is pulled in via a **lazy dynamic import** (the loader is
 * injectable for tests) and kept entirely behind this seam. One pure,
 * fully-tested helper — {@link mapPaddleResult} — carries the result mapping.
 *
 * **Privacy:** the binding is always pointed at on-device, same-origin model
 * URLs ({@link OcrModelUrls}) — never the package's built-in CDN defaults — and
 * recognition runs on the local {@link ImageData}; no image or model byte ever
 * leaves the device (docs/design.md §1.3, §8; model hosting + caching is #27).
 */
import type { OcrBackend, OcrBoundingBox, OcrEngine, OcrEngineConfig, OcrResult } from './types';

/** Axis-aligned box `ppu-paddle-ocr` reports for one recognised region. */
export interface PaddleBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One recognised text region (a word/segment), as returned by the recogniser. */
export interface PaddleOcrItem {
  text: string;
  box: PaddleBox;
  /** Recogniser confidence in `[0, 1]`. */
  confidence: number;
}

/**
 * Recognition payload from `PaddleOcrService.recognize()` in its default
 * (grouped) mode — i.e. without `flatten`. `lines` is an array of lines, each
 * itself the array of per-region {@link PaddleOcrItem}s on that line, ordered
 * left-to-right. (We map per line, so the joined `text` is unused.)
 */
export interface PaddleRecognizeResult {
  text: string;
  lines: PaddleOcrItem[][];
}

/** Construction options for `ppu-paddle-ocr`'s `PaddleOcrService` (the slice we set). */
export interface PaddleOcrServiceOptions {
  /** Local URLs/buffers of the detection + recognition models and dictionary. */
  model: { detection: string; recognition: string; charactersDictionary: string };
  /**
   * Text-detection tuning, both matching the binding's own 6.2.0 defaults but
   * pinned explicitly so a future default change can't move them under us:
   * `maxSideLength` scales the detection cap with the input (`"auto"`) rather
   * than a fixed pixel count, and `minimumAreaThreshold` keeps single-digit
   * detections above the area filter.
   */
  detection: { maxSideLength: number | 'auto'; minimumAreaThreshold: number };
  /**
   * Text-recognition tuning, both pinned away from the 6.2.0 defaults: `strategy`
   * stays on the pre-6.2.0 `per-box` (switching to `per-line` is its own A/B
   * test, not bundled into this version bump), and `minimumConfidence` is
   * disabled (`0`) so low-confidence lines are shown for review rather than
   * silently dropped.
   */
  recognition: { strategy: 'per-box'; minimumConfidence: number };
  /** ONNX Runtime session config; `executionProviders` picks WebGPU vs WASM. */
  session: { executionProviders: string[]; graphOptimizationLevel: 'all' };
  /**
   * Image pre-processing engine. The web platform ships no OpenCV
   * `imageProcessor`, so the binding only ever runs the `canvas-native` detection
   * path (it silently falls back from `opencv`); we request it explicitly.
   */
  processing: { engine: 'canvas-native' };
}

/**
 * A `WebPlatformProvider`. Its `createCanvas` is DOM-bound
 * (`document.createElement`) and its `isCanvas` does an unguarded
 * `instanceof HTMLCanvasElement`, so both are replaced with worker-safe versions
 * (see {@link patchPlatformsForWorker}). The binding creates a *separate*
 * provider for the service, the detector and the recognizer, so all three are
 * patched.
 */
export interface PaddleOcrPlatformLike {
  createCanvas?: (width: number, height: number) => unknown;
  isCanvas?: (image: unknown) => boolean;
}

/** A sub-service (detector/recognizer) that carries its own platform provider. */
interface PaddleOcrSubService {
  platform?: PaddleOcrPlatformLike;
}

/**
 * Detection-only payload from `PaddleOcrService.detect()` (added in
 * `ppu-paddle-ocr` 6.1.0). Runs the detection model without recognition, so it
 * reports *where* text is without reading it. `Box` is axis-aligned — the binding
 * offers no quads here — and `crops` (PNG-encoded regions) is only populated when
 * `crop: true` is requested, which this adapter never does.
 */
export interface PaddleDetectResult {
  boxes: PaddleBox[];
}

/** The `PaddleOcrService` instance surface this adapter drives. */
export interface PaddleOcrServiceLike {
  initialize(): Promise<void>;
  /** Accepts a canvas-like source (the binding calls `.getContext()` on it). */
  recognize(image: unknown, options?: { noCache?: boolean }): Promise<PaddleRecognizeResult>;
  /** Detection without recognition (6.1.0+); same canvas-like source. */
  detect?(image: unknown): Promise<PaddleDetectResult>;
  destroy(): Promise<void> | void;
  platform?: PaddleOcrPlatformLike;
  /** Created during `initialize()`; each holds its own platform provider. */
  detector?: PaddleOcrSubService;
  recognitor?: PaddleOcrSubService;
}

/** The slice of the `ppu-paddle-ocr/web` module surface this adapter uses. */
export interface PaddleOcrModule {
  PaddleOcrService: new (options: PaddleOcrServiceOptions) => PaddleOcrServiceLike;
}

/** Injection points that make the adapter testable without the real package. */
export interface CreatePaddleOcrEngineDeps {
  /**
   * Loads the OCR module (pointing ONNX Runtime at `wasmPath` for its WASM
   * assets first); defaults to a lazy import of `ppu-paddle-ocr/web`.
   */
  loadModule?: (wasmPath: string) => Promise<PaddleOcrModule>;
  /** Converts an {@link ImageData} frame into a source the binding accepts. */
  toImageSource?: (image: ImageData) => unknown;
}

/** Clamps a recogniser score into the `[0, 1]` confidence range. */
function clampConfidence(score: unknown): number {
  const n = Number(score);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Builds a clockwise four-point quad (top-left → top-right → bottom-right →
 * bottom-left) from the union of a line's per-region boxes, so the bbox spans
 * the whole recognised line. Returns an empty quad when no usable box is present.
 */
function lineBoxToPoints(items: PaddleOcrItem[]): Array<[number, number]> {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { box } of items) {
    if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y)) continue;
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  if (!Number.isFinite(minX)) return [];
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
}

/**
 * Maps `ppu-paddle-ocr`'s grouped `{ text, lines }` payload onto our
 * `OcrResult[]` — **one entry per recognised line**, which is the contract the
 * scan flow relies on (`ocrResultsToText` newline-joins `text`, `meanConfidence`
 * averages `confidence`). Each line's regions are concatenated left-to-right
 * into the line text, their confidences averaged, and their boxes unioned into a
 * line bbox. The binding nests `lines` as a per-line array of region objects
 * (`{ text, box: { x, y, width, height }, confidence }`), so a line is an array
 * — not a single object.
 */
export function mapPaddleResult(raw: PaddleRecognizeResult): OcrResult[] {
  const lines = Array.isArray(raw.lines) ? raw.lines : [];
  return lines.map((line) => {
    const items = Array.isArray(line) ? line : [];
    const text = items.map((item) => item.text ?? '').join(' ');
    const confidence =
      items.length === 0
        ? 0
        : clampConfidence(
            items.reduce((sum, item) => sum + (Number(item.confidence) || 0), 0) / items.length,
          );
    return { text, bbox: { points: lineBoxToPoints(items) }, confidence };
  });
}

/**
 * Maps a detection-only result onto our quad form. The binding reports
 * axis-aligned `{ x, y, width, height }` boxes here (unlike `recognize`, whose
 * per-region boxes we union per line), so each becomes a rectangular quad in the
 * same clockwise order {@link mapPaddleResult} produces. Boxes with non-finite
 * or non-positive extents are dropped rather than passed on as degenerate quads.
 */
export function mapPaddleDetectResult(raw: PaddleDetectResult): OcrBoundingBox[] {
  const boxes = Array.isArray(raw?.boxes) ? raw.boxes : [];
  const out: OcrBoundingBox[] = [];
  for (const box of boxes) {
    if (!box) continue;
    const { x, y, width, height } = box;
    if (![x, y, width, height].every((n) => Number.isFinite(n))) continue;
    if (width <= 0 || height <= 0) continue;
    out.push({
      points: [
        [x, y],
        [x + width, y],
        [x + width, y + height],
        [x, y + height],
      ],
    });
  }
  return out;
}

/** Maps our backend choice onto an ONNX Runtime execution provider. */
function executionProviderFor(backend: OcrBackend): string {
  return backend === 'webgpu' ? 'webgpu' : 'wasm';
}

/**
 * Converts an {@link ImageData} frame into an `OffscreenCanvas` the binding can
 * consume. `ppu-paddle-ocr`'s `recognize()` calls `.getContext()` on its input,
 * so it needs a canvas — a raw `ImageData` (no `getContext`) makes it throw
 * `t.getContext is not a function`.
 */
function defaultToImageSource(image: ImageData): unknown {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('OffscreenCanvas is unavailable; cannot prepare image for OCR.');
  }
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not acquire a 2D context for OCR input.');
  context.putImageData(image, 0, 0);
  return canvas;
}

/** Worker-safe replacement for the platform's DOM-bound `createCanvas`. */
function workerSafeCreateCanvas(width: number, height: number): OffscreenCanvas {
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d', { willReadFrequently: true });
  return canvas;
}

/** Worker-safe `isCanvas` that never references an unguarded `HTMLCanvasElement`. */
function workerSafeIsCanvas(image: unknown): boolean {
  if (typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas) return true;
  if (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) return true;
  return (
    typeof image === 'object' &&
    image !== null &&
    typeof (image as { getContext?: unknown }).getContext === 'function'
  );
}

/** Replaces one provider's DOM-bound methods with worker-safe ones. */
function patchPlatform(platform: PaddleOcrPlatformLike | undefined): void {
  if (!platform) return;
  platform.createCanvas = workerSafeCreateCanvas;
  platform.isCanvas = workerSafeIsCanvas;
}

/**
 * `ppu-paddle-ocr`'s web platform is written for the main thread: `createCanvas`
 * uses `document.createElement` (absent in a Worker), and `isCanvas` does an
 * unguarded `instanceof HTMLCanvasElement` (a window-only global, so the bare
 * reference *throws* `HTMLCanvasElement is not defined` in a Worker). The binding
 * instantiates a *separate* provider for the service, the detector and the
 * recognizer, so all three are patched — the detector/recognizer ones only exist
 * after `initialize()`. Lets recognition run off the main thread (docs/design.md
 * §4.2: OCR must not block the UI thread).
 */
function patchPlatformsForWorker(service: PaddleOcrServiceLike): void {
  if (typeof OffscreenCanvas === 'undefined') return;
  patchPlatform(service.platform);
  patchPlatform(service.detector?.platform);
  patchPlatform(service.recognitor?.platform);
}

/**
 * Longest-side cap the detector scales the frame to before inference. Our
 * previous fixed `1280` is superseded by 6.2.0's own `"auto"` default —
 * `clamp(0.75 × longest side, 960, 1920)` — which scales with the input
 * instead of a one-size-fits-all constant: a ~3000px phone photo now detects
 * at 1920 instead of being capped at 1280, a page rasterised at `scale: 2`
 * lands close to our old value, and the v6 model family is tuned against
 * these defaults. Pinned explicitly (rather than left unset) so a future
 * binding default change can't move it under us.
 */
const DETECTION_MAX_SIDE_LENGTH: number | 'auto' = 'auto';

/**
 * Minimum detected-box area (px²) below which a detection is discarded. Kept
 * at the binding's 6.2.0 default (down from 50 in 6.1.0) and pinned
 * explicitly: single-digit detections (Anzahl, einzelne Ziffern) survive the
 * area filter, and a future default change can't shift this under us.
 */
const DETECTION_MINIMUM_AREA_THRESHOLD = 20;

/**
 * Recognition strategy: each detected box is recognised individually. Kept
 * explicit against the 6.2.0 default (`per-line`) so this version bump stays
 * a pure fix-import, one variable at a time — `per-line` deserves its own
 * A/B test now that 6.1.1/6.1.2 fixed its crash on thin regions and its
 * "all text lands in the first box" bug.
 */
const RECOGNITION_STRATEGY = 'per-box';

/**
 * Confidence floor below which a recognised line is dropped; disabled (`0`)
 * rather than the 6.2.0 default of `0.5`. The binding would otherwise
 * silently discard low-confidence lines before they ever reach review,
 * hiding misreads from the user and inflating `meanConfidence` past the
 * "Geringe Erkennungsgenauigkeit" banner threshold in `InvoiceReview.svelte`
 * (0.8). Uncertain lines must be shown, not suppressed.
 */
const RECOGNITION_MINIMUM_CONFIDENCE = 0;

/**
 * Lazily loads the real binding. Kept dynamic so the heavy ONNX-Runtime/WASM
 * code lands in a worker-only chunk (never the main bundle), and so unit tests
 * can inject a fake loader without resolving the package at all.
 */
async function defaultLoadModule(wasmPath: string): Promise<PaddleOcrModule> {
  // Point ONNX Runtime at the on-device WASM assets before the binding spins up
  // its session, so nothing is fetched from a CDN at runtime (privacy, §1.3/§8).
  // `scripts/copy-ort-wasm.mjs` populates each app's own `static/models/ort/` at
  // build time; the URL is base-prefixed on a subpath deploy (issue #171).
  const ort = await import('onnxruntime-web');
  ort.env.wasm.wasmPaths = wasmPath;
  return (await import('ppu-paddle-ocr/web')) as unknown as PaddleOcrModule;
}

/**
 * Builds a PaddleOCR-backed {@link OcrEngine} for the given backend. The
 * resolved {@link OcrBackend} is forwarded to ONNX Runtime as its execution
 * provider (WebGPU, else WASM) and recorded so the worker can report the path.
 */
export function createPaddleOcrEngine(
  backend: OcrBackend,
  config: OcrEngineConfig,
  deps: CreatePaddleOcrEngineDeps = {},
): OcrEngine {
  const loadModule = deps.loadModule ?? defaultLoadModule;
  const toImageSource = deps.toImageSource ?? defaultToImageSource;
  let service: PaddleOcrServiceLike | null = null;

  return {
    backend,
    async init(onProgress) {
      // Free a previously loaded session before overwriting it, so a direct
      // re-init() (outside the worker, which disposes first) can't leak the old
      // ONNX session + model weights.
      if (service) {
        await service.destroy();
        service = null;
      }
      onProgress?.({ phase: 'init', ratio: null, message: 'OCR-Modell wird geladen …' });
      const mod = await loadModule(config.wasmPath);
      const created = new mod.PaddleOcrService({
        model: {
          detection: config.modelUrls.detection,
          recognition: config.modelUrls.recognition,
          charactersDictionary: config.modelUrls.dictionary,
        },
        detection: {
          maxSideLength: DETECTION_MAX_SIDE_LENGTH,
          minimumAreaThreshold: DETECTION_MINIMUM_AREA_THRESHOLD,
        },
        recognition: {
          strategy: RECOGNITION_STRATEGY,
          minimumConfidence: RECOGNITION_MINIMUM_CONFIDENCE,
        },
        session: {
          executionProviders: [executionProviderFor(backend)],
          graphOptimizationLevel: 'all',
        },
        processing: { engine: 'canvas-native' },
      });
      // initialize() creates the detector + recognizer (each with its own
      // platform provider), so patch all platforms afterwards.
      await created.initialize();
      patchPlatformsForWorker(created);
      service = created;
      onProgress?.({ phase: 'init', ratio: 1, message: 'OCR bereit.' });
    },
    async recognize(image, onProgress) {
      if (!service) throw new Error('PaddleOCR engine used before init().');
      onProgress?.({ phase: 'recognize', ratio: null, message: 'Text wird erkannt …' });
      // The binding's `recognize()` keys an internal, process-lifetime result
      // cache off only the image buffer's first 1024 bytes + total length —
      // two same-sized page scans that happen to share that prefix (e.g. a
      // blank top margin) collide and silently return a stale result. We
      // always intend a fresh recognition per frame, so disable it outright.
      const raw = await service.recognize(toImageSource(image), { noCache: true });
      const results = mapPaddleResult(raw);
      onProgress?.({ phase: 'recognize', ratio: 1 });
      return results;
    },
    async detect(image) {
      if (!service) throw new Error('PaddleOCR engine used before init().');
      if (typeof service.detect !== 'function') {
        throw new Error('Diese OCR-Bindung unterstützt keine reine Texterkennungs-Suche.');
      }
      return mapPaddleDetectResult(await service.detect(toImageSource(image)));
    },
    async dispose() {
      // Free the ONNX session + model memory and drop our reference so a later
      // init() reloads cleanly.
      if (service) {
        await service.destroy();
        service = null;
      }
    },
  };
}
