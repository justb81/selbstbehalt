// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import {
  cropImageData,
  DEFAULT_CROP_MARGIN,
  hullOfQuads,
  isCropWorthwhile,
  uncropQuad,
} from './crop';
import type { OcrBoundingBox } from './types';

/** A rectangular quad, in the clockwise order the pipeline uses. */
function rect(x: number, y: number, w: number, h: number): OcrBoundingBox {
  return {
    points: [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
  };
}

/** Structural ImageData whose pixels encode their own column index. */
function rampImage(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = x;
      data[i + 1] = y;
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
  }
  return { data, width, height, colorSpace: 'srgb' } as unknown as ImageData;
}

describe('hullOfQuads', () => {
  it('covers every quad, with a margin, clipped to the frame', () => {
    // Text between x 100..300 and y 200..400 in a 1000×1000 frame.
    const hull = hullOfQuads([rect(100, 200, 100, 50), rect(150, 350, 150, 50)], 1000, 1000, 0.1);
    // Hull 100..300 × 200..400, padded by 10 % of each extent (20 px, 20 px).
    expect(hull).toEqual({ x: 80, y: 180, width: 240, height: 240 });
  });

  it('clips the margin at the frame edges instead of going negative', () => {
    const hull = hullOfQuads([rect(0, 0, 100, 100)], 100, 100, 0.5);
    expect(hull).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('applies a sane default margin', () => {
    const hull = hullOfQuads([rect(100, 100, 200, 200)], 1000, 1000);
    // 2 % of 200 px = 4 px each side.
    expect(DEFAULT_CROP_MARGIN).toBe(0.02);
    expect(hull).toEqual({ x: 96, y: 96, width: 208, height: 208 });
  });

  // Every "nothing to crop to" case means *recognise the whole frame*, so the
  // caller needs one unambiguous signal rather than a degenerate rect.
  it('returns null when there is nothing to crop to', () => {
    expect(hullOfQuads([], 100, 100)).toBeNull();
    expect(hullOfQuads([{ points: [] }], 100, 100)).toBeNull();
    expect(hullOfQuads([rect(10, 10, 10, 10)], 0, 100)).toBeNull();
    expect(hullOfQuads([rect(10, 10, 10, 10)], 100, 0)).toBeNull();
  });

  it('returns null for a zero-area hull (a single detected point)', () => {
    expect(hullOfQuads([{ points: [[50, 50]] }], 100, 100)).toBeNull();
  });

  it('ignores non-finite points rather than poisoning the hull', () => {
    const hull = hullOfQuads(
      [
        {
          points: [
            [Number.NaN, 5],
            [Number.POSITIVE_INFINITY, 5],
          ],
        },
        rect(10, 10, 20, 20),
      ],
      100,
      100,
      0,
    );
    expect(hull).toEqual({ x: 10, y: 10, width: 20, height: 20 });
  });
});

describe('isCropWorthwhile', () => {
  it('rejects a crop that barely trims the frame — the extra pass buys nothing', () => {
    // Keeps 90 % of the area; default threshold wants at least 15 % removed.
    expect(isCropWorthwhile({ x: 0, y: 0, width: 95, height: 95 }, 100, 100)).toBe(false);
  });

  it('accepts a crop that meaningfully shrinks the frame', () => {
    // Keeps 25 %.
    expect(isCropWorthwhile({ x: 0, y: 0, width: 50, height: 50 }, 100, 100)).toBe(true);
  });

  it('honours an explicit threshold', () => {
    const rect90 = { x: 0, y: 0, width: 95, height: 95 };
    expect(isCropWorthwhile(rect90, 100, 100, 0.05)).toBe(true);
  });

  it('is false for a degenerate frame', () => {
    expect(isCropWorthwhile({ x: 0, y: 0, width: 10, height: 10 }, 0, 0)).toBe(false);
  });
});

describe('cropImageData', () => {
  it('copies exactly the requested region', () => {
    const cropped = cropImageData(rampImage(10, 10), { x: 2, y: 3, width: 4, height: 2 });
    expect(cropped?.width).toBe(4);
    expect(cropped?.height).toBe(2);
    // Top-left pixel of the crop is source (2, 3); the ramp encodes x in R, y in G.
    expect(cropped!.data[0]).toBe(2);
    expect(cropped!.data[1]).toBe(3);
    // Last pixel of the first crop row is source (5, 3).
    expect(cropped!.data[3 * 4]).toBe(5);
    expect(cropped!.data[3 * 4 + 1]).toBe(3);
    // First pixel of the second crop row is source (2, 4).
    expect(cropped!.data[4 * 4]).toBe(2);
    expect(cropped!.data[4 * 4 + 1]).toBe(4);
  });

  it('clips a rect that overhangs the frame', () => {
    const cropped = cropImageData(rampImage(10, 10), { x: 8, y: 8, width: 10, height: 10 });
    expect(cropped?.width).toBe(2);
    expect(cropped?.height).toBe(2);
  });

  it('returns null for a rect outside the frame or with no area', () => {
    const image = rampImage(10, 10);
    expect(cropImageData(image, { x: 20, y: 20, width: 5, height: 5 })).toBeNull();
    expect(cropImageData(image, { x: 0, y: 0, width: 0, height: 5 })).toBeNull();
  });

  it('does not alias the source buffer', () => {
    const source = rampImage(4, 4);
    const cropped = cropImageData(source, { x: 0, y: 0, width: 2, height: 2 })!;
    source.data.fill(0);
    expect(cropped.data[0]).toBe(0); // source (0,0) had x=0 anyway
    expect(cropped.data[4]).toBe(1); // source (1,0) → x=1, still there
  });
});

describe('uncropQuad', () => {
  // Recognition run on a crop reports crop-relative coordinates, but the page
  // preview draws on the uncropped page.
  it('shifts crop-relative coordinates back into the original frame', () => {
    const inCrop = rect(10, 20, 30, 40);
    const back = uncropQuad(inCrop, { x: 100, y: 200, width: 500, height: 500 });
    expect(back.points).toEqual([
      [110, 220],
      [140, 220],
      [140, 260],
      [110, 260],
    ]);
  });

  it('is a no-op for a crop at the origin', () => {
    const quad = rect(1, 2, 3, 4);
    expect(uncropQuad(quad, { x: 0, y: 0, width: 10, height: 10 }).points).toEqual(quad.points);
  });
});
