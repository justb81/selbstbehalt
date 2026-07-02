// SPDX-License-Identifier: Apache-2.0
/**
 * Public surface of the client-side OCR pipeline (docs/design.md §4, issues
 * #24/#25): image capture, preprocessing, the typed worker client, and the
 * shared types. The scan flow (#26) composes these.
 */
export * from './types';
export { detectBackend, isWebGpuAvailable } from './backend';
export { OcrClient, OcrClientError } from './ocr-client';
export type { OcrClientOptions, OcrInitOptions, OcrWorkerLike } from './ocr-client';
export {
  toGrayscale,
  enhanceContrast,
  applyHomography,
  preprocess,
  IDENTITY_HOMOGRAPHY,
} from './preprocess';
export type { PreprocessOptions, Homography } from './preprocess';
export {
  requestCameraStream,
  stopStream,
  captureVideoFrame,
  fileToImageData,
  fileToAllImageData,
  CaptureError,
  REAR_CAMERA_CONSTRAINTS,
} from './capture';
export type { CaptureDeps, CaptureErrorCode } from './capture';
export { renderPdfPage, renderAllPdfPages } from './pdf';
export type { RenderPdfOptions, RenderPdfDeps } from './pdf';
export {
  recognizeInvoiceImage,
  loadAllInvoiceImages,
  setOcrRecognizer,
  setAllImageLoader,
  disposeScanOcr,
  textToOcrResults,
  configureOcr,
} from './scan-ocr';
export type { OcrRecognizer, MultiImageLoader } from './scan-ocr';
export {
  buildScanResult,
  ocrResultsToText,
  meanConfidence,
  defaultProviderType,
  toReviewPositions,
  toInvoicePayload,
  DEFAULT_CONFIDENCE_THRESHOLD,
} from './scan-flow';
export type { ScanResult, ReviewState, ReviewPosition, InsuredOption } from './scan-flow';
