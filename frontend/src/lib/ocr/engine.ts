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

/** The `PaddleOcrService` instance surface this adapter drives. */
export interface PaddleOcrServiceLike {
  initialize(): Promise<void>;
  recognize(image: ImageData): Promise<PaddleRecognizeResult>;
  destroy(): Promise<void> | void;
}

/** The slice of the `ppu-paddle-ocr/web` module surface this adapter uses. */
export interface PaddleOcrModule {
  PaddleOcrService: new (options: PaddleOcrServiceOptions) => PaddleOcrServiceLike;
}

/** Injection points that make the adapter testable without the real package. */
export interface CreatePaddleOcrEngineDeps {
  /** Loads the OCR module; defaults to a lazy import of `ppu-paddle-ocr/web`. */
  loadModule?: () => Promise<PaddleOcrModule>;
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

/** Default lazy loader for the real package (kept out of the static graph). */
async function defaultLoadModule(): Promise<PaddleOcrModule> {
  // `@vite-ignore` keeps this heavy ONNX-Runtime/WASM binding out of the build
  // graph; it is resolved only on a real device, where the bundler is wired to
  // serve the package's WASM assets on-device and the local models are in place
  // (#27). Loading it eagerly would pull tens of MB of WASM into every build.
  const specifier = 'ppu-paddle-ocr/web';
  return (await import(/* @vite-ignore */ specifier)) as unknown as PaddleOcrModule;
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
  let service: PaddleOcrServiceLike | null = null;

  return {
    backend,
    async init(onProgress) {
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
      await created.initialize();
      service = created;
      onProgress?.({ phase: 'init', ratio: 1, message: 'OCR bereit.' });
    },
    async recognize(image, onProgress) {
      if (!service) throw new Error('PaddleOCR engine used before init().');
      onProgress?.({ phase: 'recognize', ratio: null, message: 'Text wird erkannt …' });
      const raw = await service.recognize(image);
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
