// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';

import {
  createPaddleOcrEngine,
  mapPaddleResult,
  type PaddleBox,
  type PaddleOcrModule,
  type PaddleOcrServiceLike,
} from './engine';
import { DEFAULT_ENGINE_CONFIG, type OcrProgress } from './types';

const image = { width: 2, height: 1, data: new Uint8ClampedArray(8) } as unknown as ImageData;

describe('mapPaddleResult', () => {
  it('maps each grouped line to one OcrResult: joined text, line bbox, mean confidence', () => {
    const results = mapPaddleResult({
      text: 'Nr Beratung\n10,72',
      lines: [
        // A line is an ARRAY of per-region items; they are concatenated L→R, the
        // confidences averaged and the boxes unioned into a single line bbox.
        [
          { text: 'Nr', box: { x: 0, y: 0, width: 4, height: 5 }, confidence: 0.99 },
          { text: 'Beratung', box: { x: 6, y: 0, width: 10, height: 5 }, confidence: 0.95 },
        ],
        [{ text: '10,72', box: { x: 0, y: 8, width: 10, height: 4 }, confidence: 0.5 }],
      ],
    });
    expect(results).toEqual([
      {
        text: 'Nr Beratung',
        bbox: {
          points: [
            [0, 0],
            [16, 0],
            [16, 5],
            [0, 5],
          ],
        },
        confidence: 0.97,
      },
      {
        text: '10,72',
        bbox: {
          points: [
            [0, 8],
            [10, 8],
            [10, 12],
            [0, 12],
          ],
        },
        confidence: 0.5,
      },
    ]);
  });

  it('clamps out-of-range confidence and yields an empty bbox when a box is missing', () => {
    const results = mapPaddleResult({
      text: 'only-text',
      lines: [[{ text: 'only-text', box: undefined as unknown as PaddleBox, confidence: 1.4 }]],
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
        lines: [[{ text: 'Hallo', box: { x: 0, y: 0, width: 1, height: 1 }, confidence: 0.9 }]],
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
      detection: { maxSideLength: 1280 },
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
    expect(service.recognize).toHaveBeenCalledWith('CANVAS', { noCache: true });
    expect(results).toEqual([
      {
        text: 'Hallo',
        bbox: {
          points: [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        },
        confidence: 0.9,
      },
    ]);
  });

  it('always disables the binding-internal result cache, so two consecutive same-size pages never collide', async () => {
    // `ppu-paddle-ocr` caches recognize() results keyed by a weak hash (only
    // the image buffer's first 1024 bytes + total length); two different
    // pages of a multi-page PDF share both when they have the same
    // dimensions and a similar top margin, which would otherwise return the
    // first page's stale result for the second. Every call must opt out.
    const service = fakeService();
    const engine = createPaddleOcrEngine('wasm', DEFAULT_ENGINE_CONFIG, {
      loadModule: async () => fakeModule(service).module,
      toImageSource: () => 'CANVAS',
    });
    await engine.init();
    await engine.recognize(image);
    await engine.recognize(image);
    expect(service.recognize).toHaveBeenNthCalledWith(1, 'CANVAS', { noCache: true });
    expect(service.recognize).toHaveBeenNthCalledWith(2, 'CANVAS', { noCache: true });
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
