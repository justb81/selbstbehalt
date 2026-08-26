// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import {
  applyHomography,
  clippedFraction,
  downscale,
  enhanceContrast,
  IDENTITY_HOMOGRAPHY,
  laplacianVariance,
  lumaPlane,
  lumaStdDev,
  meanLuma,
  measureImageQuality,
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

/**
 * Builds an opaque grayscale image from per-pixel luma values. Rec. 601's
 * weights sum to exactly 1, so a neutral pixel's luma is the value itself —
 * which keeps the expectations below readable.
 */
function gray(width: number, height: number, lumas: number[]): ImageData {
  const bytes: number[] = [];
  for (const value of lumas) bytes.push(value, value, value, 255);
  return img(width, height, bytes);
}

/** A 4×4 checkerboard — the sharpest pattern that fits an interior. */
function checkerboard(dark: number, light: number): ImageData {
  const lumas: number[] = [];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) lumas.push((x + y) % 2 === 0 ? dark : light);
  }
  return gray(4, 4, lumas);
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

describe('downscale', () => {
  it('returns the input untouched when it already fits', () => {
    const input = gray(2, 1, [10, 20]);
    expect(downscale(input, 4)).toBe(input);
    expect(downscale(input, 2)).toBe(input);
  });

  it('returns the input untouched for a non-positive maxSide', () => {
    const input = gray(2, 1, [10, 20]);
    expect(downscale(input, 0)).toBe(input);
    expect(downscale(input, -8)).toBe(input);
  });

  it('averages each destination pixel over the source box it covers', () => {
    // 4x1 -> 2x1: [0,100] and [200,255] -> 50 and 227.5 -> 228.
    const out = downscale(gray(4, 1, [0, 100, 200, 255]), 2);
    expect(out.width).toBe(2);
    expect(out.height).toBe(1);
    expect([...out.data]).toEqual([50, 50, 50, 255, 228, 228, 228, 255]);
  });

  it('collapses a whole image into one averaged pixel', () => {
    // (0 + 100 + 200 + 255) / 4 = 138.75 -> 139.
    const out = downscale(gray(2, 2, [0, 100, 200, 255]), 1);
    expect([out.width, out.height]).toEqual([1, 1]);
    expect([...out.data]).toEqual([139, 139, 139, 255]);
  });
});

describe('lumaPlane', () => {
  it('flattens RGBA to one Rec. 601 luma byte per pixel', () => {
    const plane = lumaPlane(img(2, 1, [255, 0, 0, 255, 0, 0, 255, 255]));
    // 0.299 * 255 = 76.245 -> 76 ; 0.114 * 255 = 29.07 -> 29
    expect([...plane]).toEqual([76, 29]);
  });
});

describe('laplacianVariance', () => {
  it('is zero for a flat image (no edges at all)', () => {
    expect(laplacianVariance(gray(4, 4, Array<number>(16).fill(128)))).toBe(0);
  });

  it('is zero for an image too small to have an interior', () => {
    expect(laplacianVariance(gray(2, 2, [0, 255, 255, 0]))).toBe(0);
  });

  it('is high for a hard-edged checkerboard', () => {
    // Each of the four interior pixels sees ±(4 * 255) = ±1020, mean 0.
    expect(laplacianVariance(checkerboard(0, 255))).toBeCloseTo(1020 * 1020);
  });

  it('drops as the same pattern loses amplitude (blur reads as lower energy)', () => {
    expect(laplacianVariance(checkerboard(100, 156))).toBeLessThan(
      laplacianVariance(checkerboard(0, 255)),
    );
  });
});

describe('meanLuma and lumaStdDev', () => {
  it('report the mean and spread of the luma', () => {
    const image = gray(2, 1, [0, 255]);
    expect(meanLuma(image)).toBeCloseTo(127.5);
    expect(lumaStdDev(image)).toBeCloseTo(127.5);
  });

  it('report zero spread for a flat image', () => {
    const image = gray(2, 2, [90, 90, 90, 90]);
    expect(meanLuma(image)).toBe(90);
    expect(lumaStdDev(image)).toBe(0);
  });
});

describe('clippedFraction', () => {
  it('counts pixels at or above the clipping luma', () => {
    // 249 is below the 250 threshold; 250 and 255 are not.
    expect(clippedFraction(gray(4, 1, [249, 250, 255, 0]))).toBeCloseTo(0.5);
  });

  it('is zero for a correctly exposed image', () => {
    expect(clippedFraction(gray(2, 1, [180, 240]))).toBe(0);
  });
});

describe('measureImageQuality', () => {
  it('reports all four readings in one pass', () => {
    expect(measureImageQuality(gray(4, 4, Array<number>(16).fill(128)))).toEqual({
      sharpness: 0,
      brightness: 128,
      contrast: 0,
      clipped: 0,
    });
  });

  it('measures on the downscaled copy, not the original', () => {
    const image = checkerboard(0, 255);
    // Full size, the checkerboard is maximally contrasty…
    expect(measureImageQuality(image, { maxSide: 4 }).contrast).toBeCloseTo(127.5);
    // …but averaged down to 2×2 every box holds the same mid-gray.
    expect(measureImageQuality(image, { maxSide: 2 }).contrast).toBe(0);
  });
});
