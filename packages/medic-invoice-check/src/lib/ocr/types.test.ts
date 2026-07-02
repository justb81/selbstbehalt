// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { DEFAULT_ENGINE_CONFIG, DEFAULT_MODEL_URLS, resolveOcrAssets } from './types';

describe('resolveOcrAssets', () => {
  it('resolves root-served, same-origin URLs by default', () => {
    expect(resolveOcrAssets()).toEqual({
      modelUrls: {
        detection: '/models/ocr/det.onnx',
        recognition: '/models/ocr/rec.onnx',
        dictionary: '/models/ocr/dict.txt',
      },
      wasmPath: '/models/ort/',
    });
  });

  it('prefixes every asset URL with a subpath deploy base (GitHub Pages, issue #171)', () => {
    const { modelUrls, wasmPath } = resolveOcrAssets('/selbstbehalt');
    expect(modelUrls.detection).toBe('/selbstbehalt/models/ocr/det.onnx');
    expect(modelUrls.recognition).toBe('/selbstbehalt/models/ocr/rec.onnx');
    expect(modelUrls.dictionary).toBe('/selbstbehalt/models/ocr/dict.txt');
    expect(wasmPath).toBe('/selbstbehalt/models/ort/');
  });

  it('tolerates a trailing slash on the base', () => {
    expect(resolveOcrAssets('/selbstbehalt/')).toEqual(resolveOcrAssets('/selbstbehalt'));
  });

  it('backs the exported root-served defaults', () => {
    expect(DEFAULT_MODEL_URLS).toEqual(resolveOcrAssets().modelUrls);
    expect(DEFAULT_ENGINE_CONFIG).toEqual({ language: 'de', ...resolveOcrAssets() });
  });
});
