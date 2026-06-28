// SPDX-License-Identifier: Apache-2.0
/**
 * Typed main-thread client for the OCR Web Worker (docs/design.md §4.2, issue #24).
 *
 * Wraps the worker behind a promise-based API: `init` resolves with the chosen
 * backend, `recognize` resolves with the recognised lines, and progress is
 * surfaced per call or globally. Requests are correlated by id so several can be
 * in flight, and the worker lifecycle (creation, error propagation, teardown) is
 * managed here so callers never touch `postMessage` directly.
 *
 * **Privacy:** image pixels travel only into the worker (in-process), never to
 * the network (docs/design.md §1.3, §8).
 */
import type {
  OcrBackend,
  OcrEngineConfig,
  OcrProgress,
  OcrResult,
  OcrWorkerRequest,
  OcrWorkerResponse,
} from './types';

/** Subset of the DOM `Worker` API the client relies on (injectable for tests). */
export interface OcrWorkerLike {
  postMessage(message: OcrWorkerRequest, transfer?: Transferable[]): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<OcrWorkerResponse>) => void,
  ): void;
  addEventListener(type: 'error', listener: (event: { message?: string }) => void): void;
  terminate(): void;
}

export interface OcrClientOptions {
  /** Factory for the underlying worker; defaults to the real module worker. */
  createWorker?: () => OcrWorkerLike;
  /** Global progress sink, in addition to any per-call handler. */
  onProgress?: (progress: OcrProgress) => void;
}

export interface OcrInitOptions {
  /** Force a backend; omit to auto-detect (WebGPU → WASM). */
  preferredBackend?: OcrBackend;
  config?: Partial<OcrEngineConfig>;
  onProgress?: (progress: OcrProgress) => void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  onProgress?: (progress: OcrProgress) => void;
}

/** Default worker factory — a module worker resolved relative to this file. */
function defaultCreateWorker(): OcrWorkerLike {
  return new Worker(new URL('../workers/ocr.worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as OcrWorkerLike;
}

export class OcrClient {
  #worker: OcrWorkerLike | null = null;
  #createWorker: () => OcrWorkerLike;
  #onProgress?: (progress: OcrProgress) => void;
  #pending = new Map<number, Pending>();
  #nextId = 1;

  constructor(options: OcrClientOptions = {}) {
    this.#createWorker = options.createWorker ?? defaultCreateWorker;
    this.#onProgress = options.onProgress;
  }

  #ensureWorker(): OcrWorkerLike {
    if (this.#worker) return this.#worker;
    const worker = this.#createWorker();
    worker.addEventListener('message', (event) => this.#onMessage(event.data));
    worker.addEventListener('error', (event) =>
      this.#failAll(new Error(event.message ?? 'OCR worker crashed')),
    );
    this.#worker = worker;
    return worker;
  }

  #onMessage(message: OcrWorkerResponse): void {
    if (message.type === 'progress') {
      this.#pending.get(message.id)?.onProgress?.(message.progress);
      this.#onProgress?.(message.progress);
      return;
    }
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    switch (message.type) {
      case 'ready':
        pending.resolve(message.backend);
        return;
      case 'result':
        pending.resolve(message.results);
        return;
      case 'disposed':
        pending.resolve(undefined);
        return;
      case 'error':
        pending.reject(new OcrClientError(message.error.message, message.error.code));
        return;
    }
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  #request<T>(
    build: (id: number) => { message: OcrWorkerRequest; transfer?: Transferable[] },
    onProgress?: (progress: OcrProgress) => void,
  ): Promise<T> {
    const worker = this.#ensureWorker();
    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
      const { message, transfer } = build(id);
      worker.postMessage(message, transfer);
    });
  }

  /** Loads the model and resolves with the backend the worker selected. */
  init(options: OcrInitOptions = {}): Promise<OcrBackend> {
    return this.#request<OcrBackend>(
      (id) => ({
        message: {
          type: 'init',
          id,
          preferredBackend: options.preferredBackend,
          config: options.config,
        },
      }),
      options.onProgress,
    );
  }

  /**
   * Recognises one preprocessed frame. The image's backing buffer is transferred
   * to the worker (zero-copy), so the passed {@link ImageData} must not be reused
   * afterwards.
   */
  recognize(image: ImageData, onProgress?: (progress: OcrProgress) => void): Promise<OcrResult[]> {
    return this.#request<OcrResult[]>(
      (id) => ({ message: { type: 'recognize', id, image }, transfer: [image.data.buffer] }),
      onProgress,
    );
  }

  /** Releases the model in the worker while keeping the worker alive. */
  dispose(): Promise<void> {
    return this.#request<void>((id) => ({ message: { type: 'dispose', id } }));
  }

  /** Terminates the worker and rejects any in-flight requests. */
  terminate(): void {
    this.#worker?.terminate();
    this.#worker = null;
    this.#failAll(new Error('OCR client terminated'));
  }
}

/** Error raised when the worker reports a failure, carrying the stable code. */
export class OcrClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'OcrClientError';
  }
}
