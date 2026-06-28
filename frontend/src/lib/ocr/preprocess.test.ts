// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import {
  applyHomography,
  enhanceContrast,
  IDENTITY_HOMOGRAPHY,
  preprocess,
  toGrayscale,
  type Homography,
} from './preprocess';

/** Builds an ImageData-like value from RGBA bytes. */
function img(width: number, height: number, bytes: number[]): ImageData {
  return {
    data: new Uint8ClampedArray(bytes),
    width,
    height,
    colorSpace: 'srgb',
  } as unknown as ImageData;
}

describe('toGrayscale', () => {
  it('applies Rec. 601 luma and preserves alpha', () => {
    const out = toGrayscale(img(1, 1, [255, 0, 0, 200]));
    // 0.299 * 255 = 76.245 -> 76
    expect([...out.data]).toEqual([76, 76, 76, 200]);
  });

  it('does not mutate the input', () => {
    const input = img(1, 1, [255, 0, 0, 255]);
    toGrayscale(input);
    expect([...input.data]).toEqual([255, 0, 0, 255]);
  });
});

describe('enhanceContrast', () => {
  it('factor 1 is identity', () => {
    const out = enhanceContrast(img(1, 1, [100, 150, 200, 255]), 1);
    expect([...out.data]).toEqual([100, 150, 200, 255]);
  });

  it('stretches around mid-gray and clamps, keeping alpha', () => {
    const out = enhanceContrast(img(1, 1, [100, 200, 10, 128]), 2);
    // (100-128)*2+128=72 ; (200-128)*2+128=272->255 ; (10-128)*2+128=-108->0
    expect([...out.data]).toEqual([72, 255, 0, 128]);
  });
});

describe('applyHomography', () => {
  it('identity returns the same pixels', () => {
    const input = img(2, 1, [10, 20, 30, 255, 40, 50, 60, 255]);
    const out = applyHomography(input, IDENTITY_HOMOGRAPHY);
    expect([...out.data]).toEqual([...input.data]);
  });

  it('fills out-of-source pixels with opaque white', () => {
    // Shift source by +1 in x: dest(0,0) samples src(1,0); dest(1,0) samples src(2,0) -> out of range.
    const shift: Homography = [1, 0, 1, 0, 1, 0, 0, 0, 1];
    const input = img(2, 1, [10, 20, 30, 255, 40, 50, 60, 255]);
    const out = applyHomography(input, shift);
    expect([...out.data]).toEqual([40, 50, 60, 255, 255, 255, 255, 255]);
  });
});

describe('preprocess', () => {
  it('defaults to grayscale only', () => {
    const out = preprocess(img(1, 1, [255, 0, 0, 255]));
    expect([...out.data]).toEqual([76, 76, 76, 255]);
  });

  it('skips grayscale when disabled and applies contrast', () => {
    const out = preprocess(img(1, 1, [100, 150, 200, 255]), { grayscale: false, contrast: 2 });
    // (100-128)*2+128=72 ; (150-128)*2+128=172 ; (200-128)*2+128=272->255
    expect([...out.data]).toEqual([72, 172, 255, 255]);
  });

  it('applies homography before grayscale', () => {
    const shift: Homography = [1, 0, 1, 0, 1, 0, 0, 0, 1];
    const out = preprocess(img(2, 1, [255, 0, 0, 255, 0, 0, 255, 255]), { homography: shift });
    // dest(0,0) <- src(1,0)=(0,0,255) -> luma 29 ; dest(1,0) out of range -> white luma 255
    expect([...out.data]).toEqual([29, 29, 29, 255, 255, 255, 255, 255]);
  });
});
