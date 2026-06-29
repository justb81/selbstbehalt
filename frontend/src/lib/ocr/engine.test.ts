// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';

import {
  createPaddleOcrEngine,
  mapPaddleResult,
  type PaddleOcrModule,
  type PaddleOcrServiceLike,
} from './engine';
import { DEFAULT_ENGINE_CONFIG, type OcrProgress } from './types';

const image = { width: 2, height: 1, data: new Uint8ClampedArray(8) } as unknown as ImageData;

describe('mapPaddleResult', () => {
  it('maps lines to text + quad points and carries the score through as confidence', () => {
    const results = mapPaddleResult({
      text: 'Beratung\n10,72',
      lines: [
        {
          text: 'Beratung',
          box: [
            [0, 0],
            [10, 0],
            [10, 5],
            [0, 5],
          ],
          score: 0.97,
        },
        {
          text: '10,72',
          box: [
            [0, 6],
            [10, 6],
          ],
          score: 0.5,
        },
      ],
    });
    expect(results).toEqual([
      {
        text: 'Beratung',
        bbox: {
          points: [
            [0, 0],
            [10, 0],
            [10, 5],
            [0, 5],
          ],
        },
        confidence: 0.97,
      },
      {
        text: '10,72',
        bbox: {
          points: [
            [0, 6],
            [10, 6],
          ],
        },
        confidence: 0.5,
      },
    ]);
  });

  it('clamps out-of-range scores and yields an empty bbox for malformed boxes', () => {
    const results = mapPaddleResult({
      text: 'only-text',
      lines: [{ text: 'only-text', box: undefined as unknown as [number, number][], score: 1.4 }],
    });
    expect(results).toEqual([{ text: 'only-text', bbox: { points: [] }, confidence: 1 }]);
  });

  it('returns no results when lines are missing', () => {
    expect(mapPaddleResult({ text: '', lines: undefined as unknown as [] })).toEqual([]);
  });
});

describe('createPaddleOcrEngine', () => {
  function fakeService(): PaddleOcrServiceLike {
    return {
      initialize: vi.fn().mockResolvedValue(undefined),
      recognize: vi.fn().mockResolvedValue({
        text: 'Hallo',
        lines: [
          {
            text: 'Hallo',
            box: [
              [0, 0],
              [1, 1],
            ],
            score: 0.9,
          },
        ],
      }),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
  }

  /** Builds a fake module and records the options the service was constructed with. */
  function fakeModule(service: PaddleOcrServiceLike) {
    const ctor = vi.fn().mockImplementation(function () {
      return service;
    });
    const module = { PaddleOcrService: ctor } as unknown as PaddleOcrModule;
    return { module, ctor };
  }

  it('records the backend it was built for', () => {
    const engine = createPaddleOcrEngine('wasm', DEFAULT_ENGINE_CONFIG, {
      loadModule: async () => fakeModule(fakeService()).module,
    });
    expect(engine.backend).toBe('wasm');
  });

  it('constructs the service with the local model URLs, execution provider, and reports progress', async () => {
    const service = fakeService();
    const { module, ctor } = fakeModule(service);
    const progress: OcrProgress[] = [];
    const engine = createPaddleOcrEngine(
      'webgpu',
      {
        ...DEFAULT_ENGINE_CONFIG,
        modelUrls: {
          detection: '/m/det.onnx',
          recognition: '/m/rec.onnx',
          dictionary: '/m/dict.txt',
        },
      },
      { loadModule: async () => module },
    );
    await engine.init((p) => progress.push(p));
    expect(ctor).toHaveBeenCalledWith({
      model: {
        detection: '/m/det.onnx',
        recognition: '/m/rec.onnx',
        charactersDictionary: '/m/dict.txt',
      },
      session: { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' },
      processing: { engine: 'canvas-native' },
    });
    expect(service.initialize).toHaveBeenCalledOnce();
    expect(progress.map((p) => p.phase)).toEqual(['init', 'init']);
    expect(progress.at(-1)?.ratio).toBe(1);
  });

  it('forwards the wasm backend as the wasm execution provider', async () => {
    const service = fakeService();
    const { module, ctor } = fakeModule(service);
    const engine = createPaddleOcrEngine('wasm', DEFAULT_ENGINE_CONFIG, {
      loadModule: async () => module,
    });
    await engine.init();
    expect(ctor).toHaveBeenCalledWith(
      expect.objectContaining({
        session: { executionProviders: ['wasm'], graphOptimizationLevel: 'all' },
      }),
    );
  });

  it('throws when recognize is called before init', async () => {
    const engine = createPaddleOcrEngine('wasm', DEFAULT_ENGINE_CONFIG, {
      loadModule: async () => fakeModule(fakeService()).module,
    });
    await expect(engine.recognize(image)).rejects.toThrow(/before init/);
  });

  it('converts the image to a canvas source and maps recognition output', async () => {
    const service = fakeService();
    const toImageSource = vi.fn().mockReturnValue('CANVAS');
    const engine = createPaddleOcrEngine('wasm', DEFAULT_ENGINE_CONFIG, {
      loadModule: async () => fakeModule(service).module,
      toImageSource,
    });
    await engine.init();
    const results = await engine.recognize(image);
    // The binding calls `.getContext()` on its input, so we hand it a canvas,
    // not the raw ImageData.
    expect(toImageSource).toHaveBeenCalledWith(image);
    expect(service.recognize).toHaveBeenCalledWith('CANVAS');
    expect(results).toEqual([
      {
        text: 'Hallo',
        bbox: {
          points: [
            [0, 0],
            [1, 1],
          ],
        },
        confidence: 0.9,
      },
    ]);
  });

  it('default conversion draws onto an OffscreenCanvas and patches the worker canvas factory', async () => {
    const putImageData = vi.fn();
    class FakeOffscreenCanvas {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return { putImageData };
      }
    }
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    try {
      // The real platform's isCanvas does an unguarded `instanceof
      // HTMLCanvasElement`, which throws in a Worker — model that here. The
      // binding builds a SEPARATE provider for the service, the detector and the
      // recognizer (the latter two only after initialize()), so all three must
      // be patched.
      const makePlatform = () => ({
        createCanvas: vi.fn(),
        isCanvas: () => {
          throw new ReferenceError('HTMLCanvasElement is not defined');
        },
      });
      const service = fakeService();
      service.platform = makePlatform();
      service.detector = { platform: makePlatform() };
      service.recognitor = { platform: makePlatform() };
      const original = service.platform.createCanvas;
      const engine = createPaddleOcrEngine('wasm', DEFAULT_ENGINE_CONFIG, {
        loadModule: async () => fakeModule(service).module,
      });
      await engine.init();
      // Every provider is made worker-safe: DOM-bound createCanvas → OffscreenCanvas,
      // and the throwing isCanvas → a guarded version.
      for (const platform of [
        service.platform,
        service.detector.platform,
        service.recognitor.platform,
      ]) {
        expect(platform?.createCanvas?.(3, 4)).toBeInstanceOf(FakeOffscreenCanvas);
        expect(platform?.isCanvas?.(new FakeOffscreenCanvas(1, 1))).toBe(true);
        expect(platform?.isCanvas?.({})).toBe(false);
      }
      expect(service.platform.createCanvas).not.toBe(original);

      await engine.recognize(image);
      const arg = vi.mocked(service.recognize).mock.calls[0]?.[0];
      expect(arg).toBeInstanceOf(FakeOffscreenCanvas);
      expect(putImageData).toHaveBeenCalledWith(image, 0, 0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('destroys the previous service when init() is called again without dispose()', async () => {
    const first = fakeService();
    const second = fakeService();
    const loadModule = vi
      .fn()
      .mockResolvedValueOnce(fakeModule(first).module)
      .mockResolvedValueOnce(fakeModule(second).module);
    const engine = createPaddleOcrEngine('wasm', DEFAULT_ENGINE_CONFIG, { loadModule });
    await engine.init();
    await engine.init();
    expect(first.destroy).toHaveBeenCalledOnce();
    expect(second.initialize).toHaveBeenCalledOnce();
  });

  it('dispose destroys the service so a later recognize fails again', async () => {
    const service = fakeService();
    const engine = createPaddleOcrEngine('wasm', DEFAULT_ENGINE_CONFIG, {
      loadModule: async () => fakeModule(service).module,
    });
    await engine.init();
    await engine.dispose();
    expect(service.destroy).toHaveBeenCalledOnce();
    await expect(engine.recognize(image)).rejects.toThrow(/before init/);
  });
});
