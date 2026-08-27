// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
/**
 * Public surface of the client-side OCR pipeline (docs/architecture.md §8.2, issues
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
  isBlankPage,
  mergeQualityReports,
  failingPageNumbers,
  pickSharpestFrame,
  QUALITY_THRESHOLDS,
  BLANK_PAGE_THRESHOLDS,
  QUALITY_OK_HINT,
} from './quality';
export type {
  QualityIssue,
  QualityIssueCode,
  QualityReport,
  QualityThresholds,
  BlankPageThresholds,
  PageQualityReport,
} from './quality';
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
  hullOfQuads,
  isCropWorthwhile,
  cropImageData,
  uncropQuad,
  DEFAULT_CROP_MARGIN,
} from './crop';
export type { CropRect } from './crop';
export {
  createPagePreview,
  createTextPagePreview,
  isImagePagePreview,
  buildScanPreview,
  scaleQuadToPreview,
  quadBounds,
  pageIndexForLine,
  findPreviewLineIndex,
  PREVIEW_MAX_SIDE,
  PREVIEW_MAX_PAGES,
} from './preview';
export type {
  PagePreview,
  ImagePagePreview,
  TextPagePreview,
  CreatePagePreviewOptions,
  PreviewLine,
  ScanPreview,
  QuadBounds,
  PageLineRange,
} from './preview';
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
