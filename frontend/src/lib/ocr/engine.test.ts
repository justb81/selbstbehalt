// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';

import { createPaddleOcrEngine, mapPaddleResult, type PaddleOcrModule } from './engine';
import { DEFAULT_ENGINE_CONFIG, type OcrProgress } from './types';

const image = { width: 2, height: 1, data: new Uint8ClampedArray(8) } as unknown as ImageData;

describe('mapPaddleResult', () => {
  it('pairs text with quad points and defaults confidence to 1', () => {
    const results = mapPaddleResult({
      text: ['Beratung', '10,72'],
      points: [
        [
          [0, 0],
          [10, 0],
          [10, 5],
          [0, 5],
        ],
        [
          [0, 6],
          [10, 6],
        ],
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
        confidence: 1,
      },
      {
        text: '10,72',
        bbox: {
          points: [
            [0, 6],
            [10, 6],
          ],
        },
        confidence: 1,
      },
    ]);
  });

  it('yields an empty bbox when points are missing or malformed', () => {
    const results = mapPaddleResult({ text: ['only-text'], points: undefined });
    expect(results).toEqual([{ text: 'only-text', bbox: { points: [] }, confidence: 1 }]);
  });
});

describe('createPaddleOcrEngine', () => {
  function fakeModule(): PaddleOcrModule {
    return {
      init: vi.fn().mockResolvedValue(undefined),
      recognize: vi.fn().mockResolvedValue({
        text: ['Hallo'],
        points: [
          [
            [0, 0],
            [1, 1],
          ],
        ],
      }),
    };
  }

  it('records the backend it was built for', () => {
    const engine = createPaddleOcrEngine('wasm', DEFAULT_ENGINE_CONFIG, {
      loadModule: async () => fakeModule(),
    });
    expect(engine.backend).toBe('wasm');
  });

  it('loads the model on init with the configured local URLs and reports progress', async () => {
    const mod = fakeModule();
    const progress: OcrProgress[] = [];
    const engine = createPaddleOcrEngine(
      'webgpu',
      { ...DEFAULT_ENGINE_CONFIG, modelUrls: { detection: '/m/det', recognition: '/m/rec' } },
      { loadModule: async () => mod },
    );
    await engine.init((p) => progress.push(p));
    expect(mod.init).toHaveBeenCalledWith('/m/det', '/m/rec');
    expect(progress.map((p) => p.phase)).toEqual(['init', 'init']);
    expect(progress.at(-1)?.ratio).toBe(1);
  });

  it('throws when recognize is called before init', async () => {
    const engine = createPaddleOcrEngine('wasm', DEFAULT_ENGINE_CONFIG, {
      loadModule: async () => fakeModule(),
    });
    await expect(engine.recognize(image)).rejects.toThrow(/before init/);
  });

  it('converts the image and maps recognition output', async () => {
    const mod = fakeModule();
    const toImageSource = vi.fn().mockReturnValue('SOURCE');
    const engine = createPaddleOcrEngine('wasm', DEFAULT_ENGINE_CONFIG, {
      loadModule: async () => mod,
      toImageSource,
    });
    await engine.init();
    const results = await engine.recognize(image);
    expect(toImageSource).toHaveBeenCalledWith(image);
    expect(mod.recognize).toHaveBeenCalledWith('SOURCE');
    expect(results).toEqual([
      {
        text: 'Hallo',
        bbox: {
          points: [
            [0, 0],
            [1, 1],
          ],
        },
        confidence: 1,
      },
    ]);
  });

  it('dispose drops the model so a later recognize fails again', async () => {
    const engine = createPaddleOcrEngine('wasm', DEFAULT_ENGINE_CONFIG, {
      loadModule: async () => fakeModule(),
      toImageSource: () => 'x',
    });
    await engine.init();
    engine.dispose();
    await expect(engine.recognize(image)).rejects.toThrow(/before init/);
  });
});
