// SPDX-License-Identifier: Apache-2.0
/**
 * Client-side image preprocessing for OCR (docs/design.md §4.1, issue #25).
 *
 * Pure, deterministic pixel transforms — grayscale, contrast enhancement and an
 * optional perspective (homography) correction — that raise OCR quality before
 * the frame is handed to the worker (#24). Everything runs on plain
 * {@link ImageData} buffers in memory; no canvas, DOM or network is touched, so
 * these functions are fully unit-testable and never move pixels off-device
 * (docs/design.md §1.3, §8).
 */

/** Builds an {@link ImageData}; falls back to a structural value off-DOM (tests). */
function makeImageData(data: Uint8ClampedArray, width: number, height: number): ImageData {
  if (typeof ImageData !== 'undefined') {
    const out = new ImageData(width, height);
    out.data.set(data);
    return out;
  }
  return { data, width, height, colorSpace: 'srgb' } as unknown as ImageData;
}

function clampByte(value: number): number {
  if (value < 0) return 0;
  if (value > 255) return 255;
  return Math.round(value);
}

/**
 * Converts an image to grayscale using Rec. 601 luma weights, preserving the
 * alpha channel. The result is a new image; the input is left untouched.
 */
export function toGrayscale(image: ImageData): ImageData {
  const src = image.data;
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const r = src[i] ?? 0;
    const g = src[i + 1] ?? 0;
    const b = src[i + 2] ?? 0;
    const luma = clampByte(0.299 * r + 0.587 * g + 0.114 * b);
    out[i] = luma;
    out[i + 1] = luma;
    out[i + 2] = luma;
    out[i + 3] = src[i + 3] ?? 0;
  }
  return makeImageData(out, image.width, image.height);
}

/**
 * Linearly stretches contrast around mid-gray (128). `factor` of 1 is identity;
 * values above 1 increase contrast, below 1 reduce it. Alpha is preserved.
 */
export function enhanceContrast(image: ImageData, factor: number): ImageData {
  const src = image.data;
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    out[i] = clampByte(((src[i] ?? 0) - 128) * factor + 128);
    out[i + 1] = clampByte(((src[i + 1] ?? 0) - 128) * factor + 128);
    out[i + 2] = clampByte(((src[i + 2] ?? 0) - 128) * factor + 128);
    out[i + 3] = src[i + 3] ?? 0;
  }
  return makeImageData(out, image.width, image.height);
}

/** Row-major 3×3 homography matrix mapping **destination → source** pixels. */
export type Homography = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** Identity homography (no warp). */
export const IDENTITY_HOMOGRAPHY: Homography = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Applies an inverse-mapped perspective warp: for each destination pixel the
 * matrix yields the source coordinate, which is sampled by nearest neighbour.
 * Pixels mapping outside the source are filled opaque white (invoice paper) so
 * the OCR sees clean margins. Deliberately a small, extensible step — the
 * corner-detection that produces the matrix can be layered on later.
 */
export function applyHomography(image: ImageData, matrix: Homography): ImageData {
  const { width, height } = image;
  const src = image.data;
  const out = new Uint8ClampedArray(src.length);
  const [a, b, c, d, e, f, g, h, i] = matrix;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const w = g * x + h * y + i;
      const sx = w === 0 ? -1 : Math.round((a * x + b * y + c) / w);
      const sy = w === 0 ? -1 : Math.round((d * x + e * y + f) / w);
      const di = (y * width + x) * 4;
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) {
        out[di] = 255;
        out[di + 1] = 255;
        out[di + 2] = 255;
        out[di + 3] = 255;
        continue;
      }
      const si = (sy * width + sx) * 4;
      out[di] = src[si] ?? 0;
      out[di + 1] = src[si + 1] ?? 0;
      out[di + 2] = src[si + 2] ?? 0;
      out[di + 3] = src[si + 3] ?? 0;
    }
  }
  return makeImageData(out, width, height);
}

/** Options for the {@link preprocess} pipeline. */
export interface PreprocessOptions {
  /** Convert to grayscale (default `true`). */
  grayscale?: boolean;
  /** Contrast factor; `1` (default) leaves contrast unchanged. */
  contrast?: number;
  /** Optional perspective correction applied first when provided. */
  homography?: Homography;
}

/**
 * Runs the standard preprocessing pipeline — optional perspective correction,
 * then grayscale, then contrast — returning the {@link ImageData} to feed the
 * OCR worker. Each enabled step produces a fresh buffer; the input is untouched.
 */
export function preprocess(image: ImageData, options: PreprocessOptions = {}): ImageData {
  const { grayscale = true, contrast = 1, homography } = options;
  let result = image;
  if (homography) result = applyHomography(result, homography);
  if (grayscale) result = toGrayscale(result);
  if (contrast !== 1) result = enhanceContrast(result, contrast);
  return result;
}
