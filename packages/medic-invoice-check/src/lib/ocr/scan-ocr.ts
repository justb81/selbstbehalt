// SPDX-License-Identifier: Apache-2.0
/**
 * Main-thread OCR entry point for the scan flow (issue #26).
 *
 * Wraps a lazily-created, lazily-initialised {@link OcrClient} singleton behind
 * a single `recognizeInvoiceImage` function so components never manage the
 * worker lifecycle. The recognizer is injectable ({@link setOcrRecognizer}) so
 * the scan pipeline can be unit-tested without the worker, and a dev-only
 * `window` hook lets the E2E suite drive the flow with a fixture image instead
 * of the (model-downloading) PaddleOCR binding.
 *
 * **Privacy:** the image is transferred into the worker and recognised
 * on-device; it never reaches the network (docs/design.md §1.3, §8).
 */
import { fileToAllImageData } from './capture';
import { OcrClient } from './ocr-client';
import type { OcrBackend, OcrEngineConfig, OcrProgress, OcrResult } from './types';

/** Recognises one preprocessed frame into text lines, reporting progress. */
export type OcrRecognizer = (
  image: ImageData,
  onProgress?: (progress: OcrProgress) => void,
) => Promise<OcrResult[]>;

/** Loads all pages of a user-selected file as {@link ImageData} frames. */
export type MultiImageLoader = (file: File) => Promise<ImageData[]>;

let client: OcrClient | null = null;
let initPromise: Promise<OcrBackend> | null = null;
let override: OcrRecognizer | null = null;
let multiLoaderOverride: MultiImageLoader | null = null;
let engineConfig: Partial<OcrEngineConfig> | undefined;

/**
 * Point the OCR pipeline's on-device assets at a non-root deploy base — e.g.
 * GitHub Pages serving the GOÄ-Wächter demo under `/selbstbehalt/` (issue #171).
 * Apps call this once at startup with `resolveOcrAssets(base)`; at the domain
 * root it can be omitted (the defaults already resolve there). Must run before
 * the first recognition, since the worker reads the config on `init()`.
 */
export function configureOcr(config: Partial<OcrEngineConfig>): void {
  engineConfig = config;
}

/**
 * Default recognizer: a shared worker-backed client, initialised once on first
 * use. Concurrent callers await the same in-flight `init()`; if it rejects, the
 * client and the promise are dropped so the next call constructs a fresh client
 * and retries (no half-initialised singleton lingers).
 */
async function defaultRecognize(
  image: ImageData,
  onProgress?: (progress: OcrProgress) => void,
): Promise<OcrResult[]> {
  const activeClient = (client ??= new OcrClient());
  initPromise ??= activeClient.init({ onProgress, config: engineConfig }).catch((err: unknown) => {
    client = null;
    initPromise = null;
    throw err;
  });
  await initPromise;
  return activeClient.recognize(image, onProgress);
}

/** Recognises an invoice frame via the active recognizer (override or default). */
export function recognizeInvoiceImage(
  image: ImageData,
  onProgress?: (progress: OcrProgress) => void,
): Promise<OcrResult[]> {
  return (override ?? defaultRecognize)(image, onProgress);
}

/** Loads all invoice pages from a file via the active loader (override or default). */
export function loadAllInvoiceImages(file: File): Promise<ImageData[]> {
  return (multiLoaderOverride ?? fileToAllImageData)(file);
}

/** Overrides the recognizer (tests/E2E); pass `null` to restore the default. */
export function setOcrRecognizer(recognizer: OcrRecognizer | null): void {
  override = recognizer;
}

/** Overrides the file→images loader (tests/E2E); pass `null` to restore the default. */
export function setAllImageLoader(loader: MultiImageLoader | null): void {
  multiLoaderOverride = loader;
}

/** Tears down the shared client (e.g. when leaving the scan screen). */
export function disposeScanOcr(): void {
  client?.terminate();
  client = null;
  initPromise = null;
}

/**
 * Builds canned {@link OcrResult}s from plain text — one line each, full
 * confidence. Used by the E2E hook and available to tests for fixtures.
 */
export function textToOcrResults(text: string): OcrResult[] {
  return text.split(/\r?\n/).map((line) => ({ text: line, bbox: { points: [] }, confidence: 1 }));
}

// Dev-only seam: lets the Playwright E2E suite drive the scan flow from fixture
// text, bypassing the two on-device dependencies that cannot run headless — the
// image codec (`createImageBitmap`) and the model-downloading OCR binding. The
// file-upload UI, parsing, review and save all run for real. Tree-shaken out of
// production builds: `import.meta.env.DEV` is statically false there, so the
// hook is never installed.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (
    window as unknown as { __selbstbehaltStubScan?: (text: string) => void }
  ).__selbstbehaltStubScan = (text: string) => {
    setAllImageLoader(async () => [new ImageData(1, 1)]);
    setOcrRecognizer(async () => textToOcrResults(text));
  };
}
