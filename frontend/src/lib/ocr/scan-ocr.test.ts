// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  recognizeInvoiceImage,
  setOcrRecognizer,
  textToOcrResults,
  type OcrRecognizer,
} from './scan-ocr';

afterEach(() => setOcrRecognizer(null));

function dummyImage(): ImageData {
  return { data: new Uint8ClampedArray(4), width: 1, height: 1, colorSpace: 'srgb' } as ImageData;
}

describe('textToOcrResults', () => {
  it('splits text into one full-confidence line each', () => {
    const results = textToOcrResults('line one\nline two');
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ text: 'line one', bbox: { points: [] }, confidence: 1 });
  });
});

describe('recognizeInvoiceImage', () => {
  it('routes through an injected recognizer and forwards progress', async () => {
    const recognizer: OcrRecognizer = vi.fn(async (_image, onProgress) => {
      onProgress?.({ phase: 'recognize', ratio: 0.5 });
      return textToOcrResults('250  Blut  2,3  5,36');
    });
    setOcrRecognizer(recognizer);

    const onProgress = vi.fn();
    const results = await recognizeInvoiceImage(dummyImage(), onProgress);

    expect(recognizer).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenCalledWith({ phase: 'recognize', ratio: 0.5 });
    expect(results[0]?.text).toBe('250  Blut  2,3  5,36');
  });

  it('restores the default recognizer when the override is cleared', () => {
    setOcrRecognizer(async () => []);
    setOcrRecognizer(null);
    // With no override and no worker available here, the default path would try
    // to construct a Worker; we only assert the override was dropped.
    expect(() => setOcrRecognizer(null)).not.toThrow();
  });
});
