// SPDX-License-Identifier: Apache-2.0
/**
 * PaddleOCR engine adapter (docs/design.md §4.2, issues #24/#27).
 *
 * Adapts the `ppu-paddle-ocr` (PP-OCRv5 on ONNX Runtime) binding to the
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
import type { OcrBackend, OcrEngine, OcrEngineConfig, OcrResult } from './types';

/** One recognised line as returned by `ppu-paddle-ocr`'s `recognize()`. */
export interface PaddleOcrLine {
  text: string;
  /** Quadrilateral corner points `[x, y]` in source-image pixels. */
  box: Array<[number, number]>;
  /** Recogniser confidence in `[0, 1]`. */
  score: number;
}

/** Recognition payload returned by `PaddleOcrService.recognize()`. */
export interface PaddleRecognizeResult {
  /** The full recognised text (lines joined); unused — we map per line. */
  text: string;
  lines: PaddleOcrLine[];
}

/** Construction options for `ppu-paddle-ocr`'s `PaddleOcrService` (the slice we set). */
export interface PaddleOcrServiceOptions {
  /** Local URLs/buffers of the detection + recognition models and dictionary. */
  model: { detection: string; recognition: string; charactersDictionary: string };
  /** ONNX Runtime session config; `executionProviders` picks WebGPU vs WASM. */
  session: { executionProviders: string[]; graphOptimizationLevel: 'all' };
  /** Image pre-processing engine; `canvas-native` avoids the DOM-bound opencv path. */
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

/** The `PaddleOcrService` instance surface this adapter drives. */
export interface PaddleOcrServiceLike {
  initialize(): Promise<void>;
  /** Accepts a canvas-like source (the binding calls `.getContext()` on it). */
  recognize(image: unknown): Promise<PaddleRecognizeResult>;
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
  /** Loads the OCR module; defaults to a lazy import of `ppu-paddle-ocr/web`. */
  loadModule?: () => Promise<PaddleOcrModule>;
  /** Converts an {@link ImageData} frame into a source the binding accepts. */
  toImageSource?: (image: ImageData) => unknown;
}

/** Coerces a loosely-typed box into our quad-point arrays. */
function toBoxPoints(raw: unknown): Array<[number, number]> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((pt): pt is [number, number] => Array.isArray(pt) && pt.length >= 2)
    .map((pt) => [Number(pt[0]), Number(pt[1])] as [number, number]);
}

/** Clamps a recogniser score into the `[0, 1]` confidence range. */
function clampConfidence(score: unknown): number {
  const n = Number(score);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Maps `ppu-paddle-ocr`'s `{ text, lines }` payload onto our `OcrResult[]`,
 * carrying the real per-line `score` through as confidence and a malformed or
 * missing box through as an empty bbox rather than dropping the line.
 */
export function mapPaddleResult(raw: PaddleRecognizeResult): OcrResult[] {
  const lines = Array.isArray(raw.lines) ? raw.lines : [];
  return lines.map((line) => ({
    text: line.text,
    bbox: { points: toBoxPoints(line.box) },
    confidence: clampConfidence(line.score),
  }));
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
 * Local, same-origin directory the ONNX Runtime WASM assets are served from.
 * `scripts/copy-ort-wasm.mjs` populates `frontend/static/models/ort/` at build
 * time; the service worker caches `/models/**` on first use (docs/design.md §6.3).
 */
const ORT_WASM_PATH = '/models/ort/';

/**
 * Lazily loads the real binding. Kept dynamic so the heavy ONNX-Runtime/WASM
 * code lands in a worker-only chunk (never the main bundle), and so unit tests
 * can inject a fake loader without resolving the package at all.
 */
async function defaultLoadModule(): Promise<PaddleOcrModule> {
  // Point ONNX Runtime at the on-device WASM assets before the binding spins up
  // its session, so nothing is fetched from a CDN at runtime (privacy, §1.3/§8).
  const ort = await import('onnxruntime-web');
  ort.env.wasm.wasmPaths = ORT_WASM_PATH;
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
      const mod = await loadModule();
      const created = new mod.PaddleOcrService({
        model: {
          detection: config.modelUrls.detection,
          recognition: config.modelUrls.recognition,
          charactersDictionary: config.modelUrls.dictionary,
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
      const raw = await service.recognize(toImageSource(image));
      const results = mapPaddleResult(raw);
      onProgress?.({ phase: 'recognize', ratio: 1 });
      return results;
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
