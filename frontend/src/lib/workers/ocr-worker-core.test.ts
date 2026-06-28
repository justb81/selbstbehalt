// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';

import { createOcrWorkerCore, type OcrWorkerCoreDeps } from './ocr-worker-core';
import type {
  OcrBackend,
  OcrEngine,
  OcrProgress,
  OcrResult,
  OcrWorkerResponse,
} from '../ocr/types';

const image = { width: 1, height: 1, data: new Uint8ClampedArray(4) } as unknown as ImageData;
const RESULTS: OcrResult[] = [{ text: 'x', bbox: { points: [] }, confidence: 1 }];

function fakeEngine(backend: OcrBackend, overrides: Partial<OcrEngine> = {}): OcrEngine {
  return {
    backend,
    init: vi.fn(async (onProgress?: (p: OcrProgress) => void) => {
      onProgress?.({ phase: 'init', ratio: 1 });
    }),
    recognize: vi.fn(async () => RESULTS),
    dispose: vi.fn(),
    ...overrides,
  };
}

function setup(deps: Partial<OcrWorkerCoreDeps> = {}) {
  const posts: OcrWorkerResponse[] = [];
  const engine = fakeEngine('wasm');
  const createEngine = vi.fn(async () => engine);
  const detectBackend = vi.fn(async (preferred?: OcrBackend) => preferred ?? 'wasm');
  const core = createOcrWorkerCore({
    post: (m) => posts.push(m),
    createEngine,
    detectBackend,
    ...deps,
  });
  return { core, posts, engine, createEngine, detectBackend };
}

describe('OCR worker core', () => {
  it('initialises and reports ready with the detected backend', async () => {
    const { core, posts, createEngine, detectBackend } = setup();
    await core.handle({ type: 'init', id: 1, preferredBackend: 'webgpu' });
    expect(detectBackend).toHaveBeenCalledWith('webgpu');
    expect(createEngine).toHaveBeenCalledOnce();
    expect(posts).toContainEqual({ type: 'ready', id: 1, backend: 'wasm' });
    expect(posts).toContainEqual({
      type: 'progress',
      id: 1,
      progress: { phase: 'init', ratio: 1 },
    });
  });

  it('reports init_failed and stays uninitialised when the engine throws', async () => {
    const createEngine = vi.fn(async () =>
      fakeEngine('wasm', {
        init: vi.fn().mockRejectedValue(new Error('no model')),
      }),
    );
    const { core, posts } = setup({ createEngine });
    await core.handle({ type: 'init', id: 1 });
    expect(posts).toEqual([
      { type: 'error', id: 1, error: { code: 'init_failed', message: 'no model' } },
    ]);
    // A subsequent recognize must report not_initialized.
    await core.handle({ type: 'recognize', id: 2, image });
    expect(posts.at(-1)).toMatchObject({
      type: 'error',
      id: 2,
      error: { code: 'not_initialized' },
    });
  });

  it('disposes a previous engine when re-initialised', async () => {
    const first = fakeEngine('wasm');
    const second = fakeEngine('webgpu');
    const createEngine = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const { core } = setup({ createEngine });
    await core.handle({ type: 'init', id: 1 });
    await core.handle({ type: 'init', id: 2 });
    expect(first.dispose).toHaveBeenCalledOnce();
  });

  it('recognises and forwards progress then a result', async () => {
    const engine = fakeEngine('wasm', {
      recognize: vi.fn(async (_img: ImageData, onProgress?: (p: OcrProgress) => void) => {
        onProgress?.({ phase: 'recognize', ratio: null });
        return RESULTS;
      }),
    });
    const { core, posts } = setup({ createEngine: vi.fn(async () => engine) });
    await core.handle({ type: 'init', id: 1 });
    await core.handle({ type: 'recognize', id: 2, image });
    expect(posts).toContainEqual({
      type: 'progress',
      id: 2,
      progress: { phase: 'recognize', ratio: null },
    });
    expect(posts).toContainEqual({ type: 'result', id: 2, results: RESULTS });
  });

  it('recognize before init reports not_initialized', async () => {
    const { core, posts } = setup();
    await core.handle({ type: 'recognize', id: 7, image });
    expect(posts).toEqual([
      expect.objectContaining({
        type: 'error',
        id: 7,
        error: expect.objectContaining({ code: 'not_initialized' }),
      }),
    ]);
  });

  it('reports recognize_failed when the engine throws', async () => {
    const engine = fakeEngine('wasm', { recognize: vi.fn().mockRejectedValue('bad frame') });
    const { core, posts } = setup({ createEngine: vi.fn(async () => engine) });
    await core.handle({ type: 'init', id: 1 });
    await core.handle({ type: 'recognize', id: 2, image });
    expect(posts.at(-1)).toEqual({
      type: 'error',
      id: 2,
      error: { code: 'recognize_failed', message: 'bad frame' },
    });
  });

  it('disposes the engine and acknowledges', async () => {
    const { core, posts, engine } = setup();
    await core.handle({ type: 'init', id: 1 });
    await core.handle({ type: 'dispose', id: 2 });
    expect(engine.dispose).toHaveBeenCalled();
    expect(posts.at(-1)).toEqual({ type: 'disposed', id: 2 });
  });

  it('acknowledges dispose even with no engine loaded', async () => {
    const { core, posts } = setup();
    await core.handle({ type: 'dispose', id: 3 });
    expect(posts).toEqual([{ type: 'disposed', id: 3 }]);
  });

  it('reports unknown messages as an error', async () => {
    const { core, posts } = setup();
    await core.handle({ type: 'frobnicate', id: 9 } as never);
    expect(posts.at(-1)).toMatchObject({
      type: 'error',
      id: 9,
      error: { code: 'unknown_message' },
    });
  });
});
