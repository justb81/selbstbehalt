// SPDX-License-Identifier: Apache-2.0
/**
 * Transport-agnostic core of the OCR Web Worker (docs/design.md §4.2, issue #24).
 *
 * The actual worker entry (`ocr.worker.ts`) is a thin shell that wires this
 * core to the real `self` global. Keeping the message handling here — with the
 * engine factory, backend detector and `post` callback all injected — lets us
 * unit-test the init/recognize/fallback/error paths without a real Worker, a
 * GPU, or the heavy PaddleOCR binding.
 *
 * **Privacy:** the core only ever moves pixels and recognised text between the
 * injected engine and the `post` callback. It performs no network I/O — there
 * is nothing here that could upload an image (acceptance criterion, issue #24).
 */
import { detectBackend as defaultDetectBackend } from '../ocr/backend';
import {
  DEFAULT_ENGINE_CONFIG,
  type OcrBackend,
  type OcrEngine,
  type OcrEngineConfig,
  type OcrEngineFactory,
  type OcrErrorCode,
  type OcrProgress,
  type OcrWorkerRequest,
  type OcrWorkerResponse,
} from '../ocr/types';

/** Dependencies injected into the core so it can be driven in tests. */
export interface OcrWorkerCoreDeps {
  /** Posts a message back to the main thread (wraps `self.postMessage`). */
  post: (message: OcrWorkerResponse) => void;
  /** Builds the engine for a resolved backend (defaults to the PaddleOCR adapter). */
  createEngine: OcrEngineFactory;
  /** Resolves the backend to use; defaults to WebGPU-with-WASM-fallback detection. */
  detectBackend?: (preferred?: OcrBackend) => Promise<OcrBackend>;
}

/** Turns any thrown value into a stable, serialisable error message. */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : 'Unbekannter Fehler';
}

/**
 * Builds the worker core. The returned `handle` processes one inbound message;
 * it never throws — every failure is reported as an `error` response so the
 * worker stays alive and the client's pending request settles.
 */
export function createOcrWorkerCore(deps: OcrWorkerCoreDeps) {
  const detect = deps.detectBackend ?? defaultDetectBackend;
  let engine: OcrEngine | null = null;

  const fail = (id: number, code: OcrErrorCode, err: unknown): void => {
    deps.post({ type: 'error', id, error: { code, message: errorMessage(err) } });
  };

  const reportProgress = (id: number) => (progress: OcrProgress) => {
    deps.post({ type: 'progress', id, progress });
  };

  async function handleInit(id: number, request: Extract<OcrWorkerRequest, { type: 'init' }>) {
    try {
      // Drop any previously loaded model before re-initialising.
      if (engine) {
        await engine.dispose();
        engine = null;
      }
      const backend = await detect(request.preferredBackend);
      const config: OcrEngineConfig = { ...DEFAULT_ENGINE_CONFIG, ...request.config };
      const created = await deps.createEngine(backend, config);
      await created.init(reportProgress(id));
      engine = created;
      deps.post({ type: 'ready', id, backend: created.backend });
    } catch (err) {
      engine = null;
      fail(id, 'init_failed', err);
    }
  }

  async function handleRecognize(
    id: number,
    request: Extract<OcrWorkerRequest, { type: 'recognize' }>,
  ) {
    if (!engine) {
      fail(id, 'not_initialized', 'OCR engine not initialised — send an init message first.');
      return;
    }
    try {
      const results = await engine.recognize(request.image, reportProgress(id));
      deps.post({ type: 'result', id, results });
    } catch (err) {
      fail(id, 'recognize_failed', err);
    }
  }

  async function handleDispose(id: number) {
    if (engine) {
      await engine.dispose();
      engine = null;
    }
    deps.post({ type: 'disposed', id });
  }

  return {
    async handle(message: OcrWorkerRequest): Promise<void> {
      switch (message.type) {
        case 'init':
          await handleInit(message.id, message);
          return;
        case 'recognize':
          await handleRecognize(message.id, message);
          return;
        case 'dispose':
          await handleDispose(message.id);
          return;
        default: {
          const unknown = message as { id?: number; type?: string };
          fail(
            typeof unknown.id === 'number' ? unknown.id : -1,
            'unknown_message',
            `Unknown OCR worker message: ${String(unknown.type)}`,
          );
        }
      }
    },
  };
}
