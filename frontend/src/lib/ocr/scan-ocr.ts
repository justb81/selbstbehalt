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
import { fileToImageData } from './capture';
import { OcrClient } from './ocr-client';
import type { OcrProgress, OcrResult } from './types';

/** Recognises one preprocessed frame into text lines, reporting progress. */
export type OcrRecognizer = (
  image: ImageData,
  onProgress?: (progress: OcrProgress) => void,
) => Promise<OcrResult[]>;

/** Loads a user-selected file into an {@link ImageData} frame. */
export type ImageLoader = (file: File) => Promise<ImageData>;

let client: OcrClient | null = null;
let initialized = false;
let override: OcrRecognizer | null = null;
let loaderOverride: ImageLoader | null = null;

/** Default recognizer: a shared worker-backed client, initialised on first use. */
async function defaultRecognize(
  image: ImageData,
  onProgress?: (progress: OcrProgress) => void,
): Promise<OcrResult[]> {
  client ??= new OcrClient();
  if (!initialized) {
    await client.init({ onProgress });
    initialized = true;
  }
  return client.recognize(image, onProgress);
}

/** Recognises an invoice frame via the active recognizer (override or default). */
export function recognizeInvoiceImage(
  image: ImageData,
  onProgress?: (progress: OcrProgress) => void,
): Promise<OcrResult[]> {
  return (override ?? defaultRecognize)(image, onProgress);
}

/** Loads an invoice frame from a file via the active loader (override or default). */
export function loadInvoiceImage(file: File): Promise<ImageData> {
  return (loaderOverride ?? fileToImageData)(file);
}

/** Overrides the recognizer (tests/E2E); pass `null` to restore the default. */
export function setOcrRecognizer(recognizer: OcrRecognizer | null): void {
  override = recognizer;
}

/** Overrides the file→image loader (tests/E2E); pass `null` to restore the default. */
export function setImageLoader(loader: ImageLoader | null): void {
  loaderOverride = loader;
}

/** Tears down the shared client (e.g. when leaving the scan screen). */
export function disposeScanOcr(): void {
  client?.terminate();
  client = null;
  initialized = false;
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
    setImageLoader(async () => new ImageData(1, 1));
    setOcrRecognizer(async () => textToOcrResults(text));
  };
}
