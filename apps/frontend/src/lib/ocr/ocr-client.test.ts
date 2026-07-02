// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';

import { OcrClient, OcrClientError, type OcrWorkerLike } from './ocr-client';
import type { OcrProgress, OcrWorkerRequest, OcrWorkerResponse } from './types';

class FakeWorker implements OcrWorkerLike {
  posted: Array<{ message: OcrWorkerRequest; transfer?: Transferable[] }> = [];
  terminated = false;
  #message: Array<(event: MessageEvent<OcrWorkerResponse>) => void> = [];
  #error: Array<(event: { message?: string }) => void> = [];

  postMessage(message: OcrWorkerRequest, transfer?: Transferable[]): void {
    this.posted.push({ message, transfer });
  }
  addEventListener(type: 'message' | 'error', listener: (event: never) => void): void {
    if (type === 'message') this.#message.push(listener as never);
    else this.#error.push(listener as never);
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(message: OcrWorkerResponse): void {
    for (const l of this.#message) l({ data: message } as MessageEvent<OcrWorkerResponse>);
  }
  emitError(message: string): void {
    for (const l of this.#error) l({ message });
  }
}

function imageData(): ImageData {
  return { data: new Uint8ClampedArray(4), width: 1, height: 1 } as unknown as ImageData;
}

function makeClient(onProgress?: (p: OcrProgress) => void) {
  const worker = new FakeWorker();
  const client = new OcrClient({ createWorker: () => worker, onProgress });
  return { worker, client };
}

describe('OcrClient', () => {
  it('init posts an init request and resolves with the worker backend', async () => {
    const { worker, client } = makeClient();
    const promise = client.init({ preferredBackend: 'wasm' });
    expect(worker.posted[0]!.message).toMatchObject({
      type: 'init',
      id: 1,
      preferredBackend: 'wasm',
    });
    worker.emit({ type: 'ready', id: 1, backend: 'wasm' });
    expect(await promise).toBe('wasm');
  });

  it('recognize transfers the image buffer and resolves with results', async () => {
    const { worker, client } = makeClient();
    const image = imageData();
    const promise = client.recognize(image);
    const sent = worker.posted[0]!;
    expect(sent.message.type).toBe('recognize');
    expect(sent.transfer).toEqual([image.data.buffer]);
    worker.emit({
      type: 'result',
      id: 1,
      results: [{ text: 'a', bbox: { points: [] }, confidence: 1 }],
    });
    expect(await promise).toEqual([{ text: 'a', bbox: { points: [] }, confidence: 1 }]);
  });

  it('forwards progress to both the per-call and global handlers', async () => {
    const global = vi.fn();
    const perCall = vi.fn();
    const { worker, client } = makeClient(global);
    const promise = client.recognize(imageData(), perCall);
    const progress: OcrProgress = { phase: 'recognize', ratio: 0.5 };
    worker.emit({ type: 'progress', id: 1, progress });
    worker.emit({ type: 'result', id: 1, results: [] });
    await promise;
    expect(perCall).toHaveBeenCalledWith(progress);
    expect(global).toHaveBeenCalledWith(progress);
  });

  it('rejects with an OcrClientError carrying the worker error code', async () => {
    const { worker, client } = makeClient();
    const promise = client.init();
    worker.emit({ type: 'error', id: 1, error: { code: 'init_failed', message: 'nope' } });
    await expect(promise).rejects.toBeInstanceOf(OcrClientError);
    await expect(promise).rejects.toMatchObject({ code: 'init_failed', message: 'nope' });
  });

  it('correlates concurrent requests by id', async () => {
    const { worker, client } = makeClient();
    const a = client.recognize(imageData());
    const b = client.recognize(imageData());
    // Resolve them out of order.
    worker.emit({
      type: 'result',
      id: 2,
      results: [{ text: 'second', bbox: { points: [] }, confidence: 1 }],
    });
    worker.emit({
      type: 'result',
      id: 1,
      results: [{ text: 'first', bbox: { points: [] }, confidence: 1 }],
    });
    expect((await a)[0]!.text).toBe('first');
    expect((await b)[0]!.text).toBe('second');
  });

  it('dispose resolves on the disposed acknowledgement', async () => {
    const { worker, client } = makeClient();
    const promise = client.dispose();
    worker.emit({ type: 'disposed', id: 1 });
    await expect(promise).resolves.toBeUndefined();
  });

  it('terminate stops the worker and rejects pending requests', async () => {
    const { worker, client } = makeClient();
    const promise = client.recognize(imageData());
    client.terminate();
    expect(worker.terminated).toBe(true);
    await expect(promise).rejects.toThrow(/terminated/);
  });

  it('a worker error event rejects all pending requests', async () => {
    const { worker, client } = makeClient();
    const promise = client.init();
    worker.emitError('worker exploded');
    await expect(promise).rejects.toThrow(/worker exploded/);
  });

  it('ignores responses for unknown ids', async () => {
    const { worker, client } = makeClient();
    const promise = client.init();
    worker.emit({ type: 'ready', id: 999, backend: 'wasm' });
    worker.emit({ type: 'ready', id: 1, backend: 'webgpu' });
    expect(await promise).toBe('webgpu');
  });
});
