// SPDX-License-Identifier: Apache-2.0
/**
 * PaddleOCR engine adapter (docs/design.md §4.2, issue #24).
 *
 * Adapts the `@paddle-js-models/ocr` (PP-OCRv5) binding to the {@link OcrEngine}
 * interface the worker drives. The package is a DOM-bound, model-downloading
 * dependency, so it is pulled in via a **lazy dynamic import** (the module
 * loader is injectable for tests) and kept entirely behind this seam. Two pure,
 * fully-tested helpers — {@link mapPaddleResult} and the `ImageData` → source
 * conversion — carry the real adapter logic.
 *
 * **Privacy:** the model is loaded from on-device/bundled URLs (never a remote
 * CDN) and recognition runs on the local {@link ImageData}; no image ever
 * leaves the device (docs/design.md §1.3, §8; model caching lands in #27).
 */
import type { OcrBackend, OcrEngine, OcrEngineConfig, OcrResult } from './types';

/** The slice of the `@paddle-js-models/ocr` module surface this adapter uses. */
export interface PaddleOcrModule {
  /** Loads the detection + recognition models from the given (local) URLs. */
  init(detectionModel?: string, recognitionModel?: string): Promise<void>;
  /** Recognises an image into per-line text and quadrilateral box points. */
  recognize(
    image: unknown,
    options?: unknown,
    detConfig?: unknown,
  ): Promise<{ text: string[]; points: unknown }>;
}

/** Raw recognition payload as returned by the PaddleOCR binding. */
export interface PaddleRecognizeResult {
  text: string[];
  points: unknown;
}

/** Injection points that make the adapter testable without the real package. */
export interface CreatePaddleOcrEngineDeps {
  /** Loads the OCR module; defaults to a lazy import of `@paddle-js-models/ocr`. */
  loadModule?: () => Promise<PaddleOcrModule>;
  /** Converts an {@link ImageData} frame into a source the binding accepts. */
  toImageSource?: (image: ImageData) => unknown;
}

/** Coerces PaddleOCR's loosely-typed `points` into our quad-point arrays. */
function toBoxPoints(raw: unknown): Array<[number, number]> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((pt): pt is [number, number] => Array.isArray(pt) && pt.length >= 2)
    .map((pt) => [Number(pt[0]), Number(pt[1])] as [number, number]);
}

/**
 * Maps PaddleOCR's `{ text[], points }` payload onto our `OcrResult[]`.
 *
 * The PP-OCRv5 binding returns no per-line score, so confidence defaults to `1`;
 * lines are paired with their box by index, and a missing box yields an empty
 * bbox rather than dropping the line.
 */
export function mapPaddleResult(raw: PaddleRecognizeResult): OcrResult[] {
  const boxes = Array.isArray(raw.points) ? (raw.points as unknown[]) : [];
  return raw.text.map((text, i) => ({
    text,
    bbox: { points: toBoxPoints(boxes[i]) },
    confidence: 1,
  }));
}

/** Default `ImageData` → image-source conversion using an `OffscreenCanvas`. */
function defaultToImageSource(image: ImageData): unknown {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('OffscreenCanvas is unavailable; cannot prepare image for OCR.');
  }
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not acquire a 2D context for OCR input.');
  context.putImageData(image, 0, 0);
  return canvas;
}

/** Default lazy loader for the real package (kept out of the static graph). */
async function defaultLoadModule(): Promise<PaddleOcrModule> {
  // A runtime specifier + `@vite-ignore` keeps this DOM-bound, model-downloading
  // dependency out of the build graph; it is only resolved on a real device once
  // the local models are in place (#27).
  const specifier = '@paddle-js-models/ocr';
  return (await import(/* @vite-ignore */ specifier)) as unknown as PaddleOcrModule;
}

/**
 * Builds a PaddleOCR-backed {@link OcrEngine} for the given backend. The
 * `@paddle-js-models/ocr` binding selects its own compute backend internally;
 * `backend` is recorded so the worker can report which path was chosen.
 */
export function createPaddleOcrEngine(
  backend: OcrBackend,
  config: OcrEngineConfig,
  deps: CreatePaddleOcrEngineDeps = {},
): OcrEngine {
  const loadModule = deps.loadModule ?? defaultLoadModule;
  const toImageSource = deps.toImageSource ?? defaultToImageSource;
  let module: PaddleOcrModule | null = null;

  return {
    backend,
    async init(onProgress) {
      onProgress?.({ phase: 'init', ratio: null, message: 'OCR-Modell wird geladen …' });
      const mod = await loadModule();
      await mod.init(config.modelUrls?.detection, config.modelUrls?.recognition);
      module = mod;
      onProgress?.({ phase: 'init', ratio: 1, message: 'OCR bereit.' });
    },
    async recognize(image, onProgress) {
      if (!module) throw new Error('PaddleOCR engine used before init().');
      onProgress?.({ phase: 'recognize', ratio: null, message: 'Text wird erkannt …' });
      const source = toImageSource(image);
      const raw = await module.recognize(source);
      const results = mapPaddleResult({ text: raw.text, points: raw.points });
      onProgress?.({ phase: 'recognize', ratio: 1 });
      return results;
    },
    dispose() {
      // The binding holds a process-global model; drop our reference so a later
      // init() reloads cleanly. GPU/WASM teardown is owned by the binding.
      module = null;
    },
  };
}
