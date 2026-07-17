// SPDX-License-Identifier: Apache-2.0
/**
 * Shared types for the client-side OCR pipeline (docs/design.md §4, issues
 * #24/#25). These describe three boundaries:
 *
 *  - the **OCR result** shape (`{ text, bbox, confidence }`) the GOÄ parser and
 *    the review screen consume,
 *  - the **worker message protocol** between the main thread and
 *    `workers/ocr.worker.ts`, and
 *  - the **engine interface** the worker drives, so the heavy, DOM-bound
 *    PaddleOCR binding (and any future engine) sits behind a single seam that
 *    can be mocked in tests.
 *
 * **Privacy by design:** every type here carries pixels or recognised text
 * only between the camera/canvas, the worker and the parser — all on-device.
 * Nothing in this protocol leaves the browser (docs/design.md §1.3, §8).
 */

/**
 * Compute backend for the OCR engine. `webgpu` is preferred for speed; `wasm`
 * is the universal fallback when WebGPU is unavailable (docs/design.md §2.2).
 */
export type OcrBackend = 'webgpu' | 'wasm';

/** Quadrilateral bounding box of a recognised text line, in source-image pixels. */
export interface OcrBoundingBox {
  /** Corner points `[x, y]`, clockwise starting at the top-left. */
  points: Array<[number, number]>;
}

/** A single recognised text line. */
export interface OcrResult {
  /** Recognised text content of the line. */
  text: string;
  /** Where the line sits in the source image. */
  bbox: OcrBoundingBox;
  /** Recogniser confidence in `[0, 1]`. */
  confidence: number;
}

/**
 * One page queued for the scan pipeline (issue #278): either lines already
 * read from a PDF's text layer (no OCR needed, `confidence` fixed at `1`) or
 * a rasterised frame still needing preprocessing + OCR. A multi-page PDF can
 * mix both kinds — the decision is made per page.
 */
export type ScanPage = { kind: 'text'; lines: OcrResult[] } | { kind: 'image'; image: ImageData };

/** Lifecycle phase reported through {@link OcrProgress}. */
export type OcrPhase = 'init' | 'recognize';

/** Coarse progress signal so the UI can show a spinner/percentage. */
export interface OcrProgress {
  phase: OcrPhase;
  /** Fraction in `[0, 1]`, or `null` when the step is indeterminate. */
  ratio: number | null;
  /** Human-readable, de-DE status line for the UI. */
  message?: string;
}

/** Stable error codes so callers can branch without string matching. */
export type OcrErrorCode =
  'init_failed' | 'recognize_failed' | 'dispose_failed' | 'not_initialized' | 'unknown_message';

/** Serialisable error carried over the worker boundary. */
export interface OcrErrorPayload {
  code: OcrErrorCode;
  message: string;
}

/**
 * Local URLs of the three OCR model assets the `ppu-paddle-ocr` binding needs:
 * the PP-OCRv5 detection + recognition ONNX models and the character dictionary.
 * These point at on-device, same-origin assets under `models/ocr/` — never a
 * remote CDN — so both the image and the model stay local (docs/design.md §1.3,
 * §8). The service worker caches `models/**` on first use (docs/design.md §6.3).
 */
export interface OcrModelUrls {
  detection: string;
  recognition: string;
  dictionary: string;
}

/**
 * On-device asset locations, relative to the app's deploy base. The model files
 * *and* the ONNX Runtime WASM are served same-origin under `models/**` (never a
 * remote CDN), so both image and model stay local (docs/design.md §1.3, §8).
 */
const OCR_ASSET_PATHS = {
  detection: 'models/ocr/det.onnx',
  recognition: 'models/ocr/rec.onnx',
  dictionary: 'models/ocr/dict.txt',
  wasmDir: 'models/ort/',
} as const;

/**
 * Resolve the on-device OCR asset URLs for a deploy base path: `''` at the
 * domain root (apps/frontend, or a custom domain) or e.g. `'/selbstbehalt'` when
 * GitHub Pages serves the GOÄ-Wächter demo under a project subpath (issue #171).
 * A trailing slash on `base` is tolerated. The binding is *always* pointed at
 * these local paths (never its built-in CDN defaults) so no model is fetched
 * from a third party at runtime — see `apps/frontend/static/models/ocr/README.md`.
 */
export function resolveOcrAssets(base = ''): Pick<OcrEngineConfig, 'modelUrls' | 'wasmPath'> {
  // Strip trailing slashes with a linear scan rather than a `/\/+$/` regex,
  // which backtracks quadratically on long slash runs (CodeQL js/polynomial-redos).
  let end = base.length;
  while (end > 0 && base[end - 1] === '/') end--;
  const prefix = base.slice(0, end);
  return {
    modelUrls: {
      detection: `${prefix}/${OCR_ASSET_PATHS.detection}`,
      recognition: `${prefix}/${OCR_ASSET_PATHS.recognition}`,
      dictionary: `${prefix}/${OCR_ASSET_PATHS.dictionary}`,
    },
    wasmPath: `${prefix}/${OCR_ASSET_PATHS.wasmDir}`,
  };
}

/** Default, root-served on-device model locations ({@link resolveOcrAssets} at `''`). */
export const DEFAULT_MODEL_URLS: OcrModelUrls = resolveOcrAssets().modelUrls;

/** Engine construction options shared by the worker and the engine factory. */
export interface OcrEngineConfig {
  /** Recognition language; the app targets German (Latin-script) invoices. */
  language: 'de';
  /** Local URLs of the PP-OCRv5 models + dictionary (defaults to {@link DEFAULT_MODEL_URLS}). */
  modelUrls: OcrModelUrls;
  /**
   * Local, same-origin directory (trailing slash) the ONNX Runtime WASM assets
   * are served from. Base-prefixed via {@link resolveOcrAssets} on a subpath deploy.
   */
  wasmPath: string;
}

/** Default engine configuration for German, on-device PP-OCRv5 (root-served). */
export const DEFAULT_ENGINE_CONFIG: OcrEngineConfig = {
  language: 'de',
  ...resolveOcrAssets(),
};

// ---------------------------------------------------------------------------
// Worker message protocol (main thread → worker)
// ---------------------------------------------------------------------------

/** Initialise the engine, picking/forcing a backend and optional model URLs. */
export interface OcrInitRequest {
  type: 'init';
  /** Correlation id echoed back on `ready`/`error`. */
  id: number;
  /** Force a backend; omit to auto-detect (WebGPU → WASM). */
  preferredBackend?: OcrBackend;
  config?: Partial<OcrEngineConfig>;
}

/** Recognise one preprocessed image. `image.data.buffer` should be transferred. */
export interface OcrRecognizeRequest {
  type: 'recognize';
  id: number;
  image: ImageData;
}

/** Tear the engine down and free model memory; the worker stays alive. */
export interface OcrDisposeRequest {
  type: 'dispose';
  id: number;
}

export type OcrWorkerRequest = OcrInitRequest | OcrRecognizeRequest | OcrDisposeRequest;

// ---------------------------------------------------------------------------
// Worker message protocol (worker → main thread)
// ---------------------------------------------------------------------------

/** Engine initialised and ready to recognise on the chosen backend. */
export interface OcrReadyResponse {
  type: 'ready';
  id: number;
  backend: OcrBackend;
}

/** Recognition finished for request `id`. */
export interface OcrResultResponse {
  type: 'result';
  id: number;
  results: OcrResult[];
}

/** Engine disposed for request `id`. */
export interface OcrDisposedResponse {
  type: 'disposed';
  id: number;
}

/** Progress for the in-flight request (`id` is the request it belongs to). */
export interface OcrProgressResponse {
  type: 'progress';
  id: number;
  progress: OcrProgress;
}

/** A request failed; `id` ties it to the originating request. */
export interface OcrErrorResponse {
  type: 'error';
  id: number;
  error: OcrErrorPayload;
}

export type OcrWorkerResponse =
  | OcrReadyResponse
  | OcrResultResponse
  | OcrDisposedResponse
  | OcrProgressResponse
  | OcrErrorResponse;

// ---------------------------------------------------------------------------
// Engine interface (driven by the worker, implemented by the PaddleOCR adapter)
// ---------------------------------------------------------------------------

/**
 * An OCR engine the worker can drive. Implementations are responsible for
 * loading their model on-device and recognising an {@link ImageData} frame.
 */
export interface OcrEngine {
  readonly backend: OcrBackend;
  /** Load the model. Long-running; reports coarse progress when it can. */
  init(onProgress?: (progress: OcrProgress) => void): Promise<void>;
  /** Recognise a single preprocessed frame into text lines. */
  recognize(image: ImageData, onProgress?: (progress: OcrProgress) => void): Promise<OcrResult[]>;
  /** Release the model and any GPU/WASM resources. */
  dispose(): Promise<void> | void;
}

/** Builds an {@link OcrEngine} for a resolved backend. */
export type OcrEngineFactory = (
  backend: OcrBackend,
  config: OcrEngineConfig,
) => OcrEngine | Promise<OcrEngine>;
