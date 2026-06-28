// SPDX-License-Identifier: Apache-2.0
/// <reference lib="webworker" />
/**
 * OCR Web Worker entry point (docs/design.md §4.2, issue #24).
 *
 * Deliberately tiny: it wires the transport-agnostic {@link createOcrWorkerCore}
 * to this worker's `self`, injecting the real PaddleOCR engine factory and the
 * WebGPU/WASM backend detector. All testable logic lives in `ocr-worker-core.ts`
 * and `../ocr/*`; running OCR off the main thread here keeps the UI responsive
 * during recognition.
 */
import { createPaddleOcrEngine } from '../ocr/engine';
import { createOcrWorkerCore } from './ocr-worker-core';
import type { OcrWorkerRequest } from '../ocr/types';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

const core = createOcrWorkerCore({
  post: (message) => ctx.postMessage(message),
  createEngine: createPaddleOcrEngine,
});

ctx.addEventListener('message', (event: MessageEvent<OcrWorkerRequest>) => {
  void core.handle(event.data);
});
