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
  downscale,
  makeImageData,
  lumaPlane,
  laplacianVariance,
  meanLuma,
  lumaStdDev,
  clippedFraction,
  measureImageQuality,
  QUALITY_METRIC_MAX_SIDE,
  CLIPPING_LUMA,
} from './preprocess';
export type {
  PreprocessOptions,
  Homography,
  ImageQualityMetrics,
  MeasureQualityOptions,
} from './preprocess';
export {
  assessImageQuality,
  mergeQualityReports,
  failingPageNumbers,
  pickSharpestFrame,
  QUALITY_THRESHOLDS,
  QUALITY_OK_HINT,
} from './quality';
export type { QualityIssue, QualityIssueCode, QualityReport, QualityThresholds } from './quality';
export {
  requestCameraStream,
  stopStream,
  captureVideoFrame,
  captureBestVideoFrame,
  capturePhoto,
  grabPreviewFrame,
  fileToImageData,
  fileToAllPages,
  filesToAllPages,
  sortFilesByName,
  CaptureError,
  REAR_CAMERA_CONSTRAINTS,
  BEST_FRAME_SAMPLE_COUNT,
  BEST_FRAME_INTERVAL_MS,
} from './capture';
export type { CaptureDeps, CaptureErrorCode } from './capture';
export {
  renderPdfPage,
  renderAllPdfPages,
  extractPdfPageLines,
  extractOrRenderAllPdfPages,
  reconstructPdfTextLines,
  isUsableTextLayer,
} from './pdf';
export type { RenderPdfOptions, RenderPdfDeps, PdfTextItemLike, PdfTextContentLike } from './pdf';
export {
  recognizeInvoiceImage,
  loadAllInvoicePages,
  setOcrRecognizer,
  setPageLoader,
  disposeScanOcr,
  textToOcrResults,
  configureOcr,
} from './scan-ocr';
export type { OcrRecognizer, MultiPageLoader } from './scan-ocr';
export {
  createPagePreview,
  buildScanPreview,
  scaleQuadToPreview,
  quadBounds,
  pageIndexForLine,
  findPreviewLineIndex,
  PREVIEW_MAX_SIDE,
  PREVIEW_MAX_PAGES,
} from './preview';
export type { PagePreview, PreviewLine, ScanPreview, QuadBounds, PageLineRange } from './preview';
export {
  buildScanResult,
  ocrResultsToText,
  meanConfidence,
  positionLineIndices,
  scheduleForProviderType,
  toReviewPositions,
  toInvoicePayload,
  DEFAULT_CONFIDENCE_THRESHOLD,
} from './scan-flow';
export type { ScanResult, ReviewState, ReviewPosition, InsuredOption } from './scan-flow';
