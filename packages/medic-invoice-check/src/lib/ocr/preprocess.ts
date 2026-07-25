// SPDX-License-Identifier: Apache-2.0
/**
 * Client-side image preprocessing for OCR (docs/design.md §4.1, issues #25/#279).
 *
 * Pure, deterministic pixel transforms — grayscale, contrast enhancement and an
 * optional perspective (homography) correction — that raise OCR quality before
 * the frame is handed to the worker (#24), plus the {@link measureImageQuality}
 * metrics that judge whether a frame is worth recognising at all (#279).
 * Everything runs on plain {@link ImageData} buffers in memory; no canvas, DOM
 * or network is touched, so these functions are fully unit-testable and never
 * move pixels off-device (docs/design.md §1.3, §8).
 *
 * This module measures; it does not decide. The thresholds that turn these
 * numbers into user-facing advice live in `./quality`.
 */

/** Builds an {@link ImageData}; falls back to a structural value off-DOM (tests). */
export function makeImageData(data: Uint8ClampedArray, width: number, height: number): ImageData {
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

// --- Quality metrics (issue #279) -------------------------------------------

/**
 * Longest edge, in pixels, the quality metrics are measured on. Metrics run on
 * a downscaled copy so they stay cheap enough for a live preview (#281) — and,
 * just as importantly, so their values are comparable across devices instead of
 * drifting with the sensor resolution. Same reasoning as
 * `DETECTION_MAX_SIDE_LENGTH` in `./engine`, at the opposite end of the scale.
 */
export const QUALITY_METRIC_MAX_SIDE = 256;

/** Luma at or above which a pixel counts as blown out (clipped highlight). */
export const CLIPPING_LUMA = 250;

/**
 * Shrinks an image so its longest edge is at most `maxSide`, averaging each
 * destination pixel over the source box it covers. Returns the input untouched
 * when it already fits (or when `maxSide` is not positive), so callers that
 * already hold a small frame — the live preview grabs one directly at this size
 * — pay nothing and never resample twice.
 *
 * Box averaging rather than nearest neighbour is deliberate: point-sampling a
 * sharp, high-resolution photo aliases, which would show up as *more* apparent
 * high-frequency energy and make a crisp image look noisy to
 * {@link laplacianVariance}. Averaging low-passes uniformly, so the sharpness
 * reading reflects the original rather than the sampling grid.
 */
export function downscale(image: ImageData, maxSide: number): ImageData {
  const { width, height } = image;
  const longest = Math.max(width, height);
  if (maxSide <= 0 || longest <= maxSide) return image;

  const scale = maxSide / longest;
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  const src = image.data;
  const out = new Uint8ClampedArray(outWidth * outHeight * 4);

  for (let oy = 0; oy < outHeight; oy++) {
    const y0 = Math.floor((oy * height) / outHeight);
    const y1 = Math.max(y0 + 1, Math.floor(((oy + 1) * height) / outHeight));
    for (let ox = 0; ox < outWidth; ox++) {
      const x0 = Math.floor((ox * width) / outWidth);
      const x1 = Math.max(x0 + 1, Math.floor(((ox + 1) * width) / outWidth));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const si = (y * width + x) * 4;
          r += src[si] ?? 0;
          g += src[si + 1] ?? 0;
          b += src[si + 2] ?? 0;
          a += src[si + 3] ?? 0;
          count++;
        }
      }
      const di = (oy * outWidth + ox) * 4;
      out[di] = clampByte(r / count);
      out[di + 1] = clampByte(g / count);
      out[di + 2] = clampByte(b / count);
      out[di + 3] = clampByte(a / count);
    }
  }
  return makeImageData(out, outWidth, outHeight);
}

/**
 * Flattens an image to one luma byte per pixel using the same Rec. 601 weights
 * as {@link toGrayscale}. Every metric below reads this plane, so a caller
 * measuring several of them at once (see {@link measureImageQuality}) walks the
 * pixels once instead of once per metric.
 */
export function lumaPlane(image: ImageData): Uint8ClampedArray {
  const src = image.data;
  const count = image.width * image.height;
  const out = new Uint8ClampedArray(count);
  for (let p = 0; p < count; p++) {
    const i = p * 4;
    const r = src[i] ?? 0;
    const g = src[i + 1] ?? 0;
    const b = src[i + 2] ?? 0;
    out[p] = clampByte(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return out;
}

/** Variance of the 3×3 Laplacian over the interior pixels of a luma plane. */
function planeLaplacianVariance(plane: Uint8ClampedArray, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const value =
        (plane[i - width] ?? 0) +
        (plane[i - 1] ?? 0) +
        (plane[i + 1] ?? 0) +
        (plane[i + width] ?? 0) -
        4 * (plane[i] ?? 0);
      sum += value;
      sumSquares += value * value;
      count++;
    }
  }
  const mean = sum / count;
  return sumSquares / count - mean * mean;
}

/** Mean of a luma plane. */
function planeMean(plane: Uint8ClampedArray): number {
  if (plane.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < plane.length; i++) sum += plane[i] ?? 0;
  return sum / plane.length;
}

/** Standard deviation of a luma plane. */
function planeStdDev(plane: Uint8ClampedArray): number {
  if (plane.length === 0) return 0;
  const mean = planeMean(plane);
  let sumSquares = 0;
  for (let i = 0; i < plane.length; i++) {
    const delta = (plane[i] ?? 0) - mean;
    sumSquares += delta * delta;
  }
  return Math.sqrt(sumSquares / plane.length);
}

/** Share of a luma plane at or above {@link CLIPPING_LUMA}, in `[0, 1]`. */
function planeClippedFraction(plane: Uint8ClampedArray): number {
  if (plane.length === 0) return 0;
  let clipped = 0;
  for (let i = 0; i < plane.length; i++) {
    if ((plane[i] ?? 0) >= CLIPPING_LUMA) clipped++;
  }
  return clipped / plane.length;
}

/**
 * Sharpness: the variance of the 3×3 Laplacian (`[0,1,0; 1,-4,1; 0,1,0]`) over
 * the image's interior. A crisp photo of printed text carries a lot of
 * high-frequency edge energy and scores high; a blurred or shaken one scores
 * near zero. Returns `0` for images too small to have an interior.
 *
 * Note the reading also drops when the image is simply low-contrast, which is
 * why {@link measureImageQuality} reports contrast separately — the two hints a
 * user needs ("hold still" vs. "flatten the page") are different.
 */
export function laplacianVariance(image: ImageData): number {
  return planeLaplacianVariance(lumaPlane(image), image.width, image.height);
}

/** Brightness: mean luma across the image, in `[0, 255]`. */
export function meanLuma(image: ImageData): number {
  return planeMean(lumaPlane(image));
}

/** Contrast: standard deviation of the luma across the image. */
export function lumaStdDev(image: ImageData): number {
  return planeStdDev(lumaPlane(image));
}

/**
 * Glare / overexposure: the share of pixels clipped to near-white, in `[0, 1]`.
 * Specular reflections on glossy invoice paper blow out to pure white and wipe
 * out the text underneath; correctly exposed paper white stays below
 * {@link CLIPPING_LUMA}.
 */
export function clippedFraction(image: ImageData): number {
  return planeClippedFraction(lumaPlane(image));
}

/** The four raw quality readings of one frame; see `./quality` for the verdict. */
export interface ImageQualityMetrics {
  /** Variance of the Laplacian — higher is sharper. */
  sharpness: number;
  /** Mean luma in `[0, 255]`. */
  brightness: number;
  /** Luma standard deviation — higher is more contrasty. */
  contrast: number;
  /** Share of near-white, clipped pixels in `[0, 1]`. */
  clipped: number;
}

/** Options for {@link measureImageQuality}. */
export interface MeasureQualityOptions {
  /** Longest edge to measure on (default {@link QUALITY_METRIC_MAX_SIDE}). */
  maxSide?: number;
}

/**
 * Measures all four quality metrics of a frame in one pass: downscale once,
 * build one luma plane, read four numbers off it. This is the entry point the
 * scan gate (#279) and the live preview (#281) use; the individual metric
 * functions above exist for targeted tests and standalone use.
 */
export function measureImageQuality(
  image: ImageData,
  options: MeasureQualityOptions = {},
): ImageQualityMetrics {
  const { maxSide = QUALITY_METRIC_MAX_SIDE } = options;
  const small = downscale(image, maxSide);
  const plane = lumaPlane(small);
  return {
    sharpness: planeLaplacianVariance(plane, small.width, small.height),
    brightness: planeMean(plane),
    contrast: planeStdDev(plane),
    clipped: planeClippedFraction(plane),
  };
}
