// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
/**
 * Cropping a frame to the region that actually carries text (docs/architecture.md §6.1).
 *
 * The detector scales every frame down to a fixed longest-edge budget before
 * inference (`DETECTION_MAX_SIDE_LENGTH` in `./engine`). On a phone photo of an
 * invoice lying on a desk, a good part of that budget is spent resolving desk:
 * the page might occupy half the frame, so the text is rendered at half the
 * resolution the model could have had. Cropping to the printed area first spends
 * the whole budget on the page.
 *
 * The geometry lives here as pure functions so it is testable without inference
 * or a canvas. The detection pass that supplies the quads is
 * {@link OcrEngine.detect} (`./engine`); see the note in §6.1 of the architecture doc
 * on why enabling this in the default pipeline is gated on a measurement rather
 * than on the argument above.
 */
import { makeImageData } from './preprocess';
import type { OcrBoundingBox } from './types';

/** An axis-aligned region of a frame, in source pixels. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Fraction of the hull's size added on each side, so the crop does not shave the
 * ascenders and descenders the detector's own boxes sit tight against. 2 % of the
 * page is a few millimetres of paper — enough margin to keep glyphs whole without
 * inviting the desk back in.
 */
export const DEFAULT_CROP_MARGIN = 0.02;

/**
 * Smallest rectangle covering every quad, expanded by `margin` and clipped to the
 * frame. Returns `null` when there is nothing to crop to — no quads, no finite
 * points, or a degenerate frame — which the caller should read as "recognise the
 * whole frame", not as an error.
 *
 * Quads are in source-frame pixels, as the detector reports them.
 */
export function hullOfQuads(
  quads: ReadonlyArray<OcrBoundingBox>,
  frameWidth: number,
  frameHeight: number,
  margin = DEFAULT_CROP_MARGIN,
): CropRect | null {
  if (frameWidth <= 0 || frameHeight <= 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const quad of quads) {
    for (const [x, y] of quad.points) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return null;

  const padX = (maxX - minX) * margin;
  const padY = (maxY - minY) * margin;
  const x = Math.max(0, Math.floor(minX - padX));
  const y = Math.max(0, Math.floor(minY - padY));
  const right = Math.min(frameWidth, Math.ceil(maxX + padX));
  const bottom = Math.min(frameHeight, Math.ceil(maxY + padY));
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Whether cropping to `rect` is worth a second inference pass. A crop that keeps
 * almost the whole frame buys no resolution but still costs a detection run, so
 * the caller should skip it: below `minReduction` (default 15 % of the area
 * removed) this returns `false`.
 */
export function isCropWorthwhile(
  rect: CropRect,
  frameWidth: number,
  frameHeight: number,
  minReduction = 0.15,
): boolean {
  const frameArea = frameWidth * frameHeight;
  if (frameArea <= 0) return false;
  const kept = (rect.width * rect.height) / frameArea;
  return kept <= 1 - minReduction;
}

/**
 * Copies `rect` out of `image` into a new {@link ImageData}. Pure row-wise buffer
 * arithmetic — no canvas — so it runs in a worker and in tests alike. `rect` is
 * clipped to the frame; a rect entirely outside it yields `null`.
 */
export function cropImageData(image: ImageData, rect: CropRect): ImageData | null {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(image.width, x0 + Math.floor(rect.width));
  const y1 = Math.min(image.height, y0 + Math.floor(rect.height));
  const width = x1 - x0;
  const height = y1 - y0;
  if (width <= 0 || height <= 0) return null;

  const src = image.data;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcStart = ((y0 + y) * image.width + x0) * 4;
    out.set(src.subarray(srcStart, srcStart + width * 4), y * width * 4);
  }
  return makeImageData(out, width, height);
}

/**
 * Maps a quad from cropped-frame coordinates back into the original frame, by
 * adding the crop offset. Needed because the page preview draws on the *uncropped*
 * page: recognition run on a crop reports coordinates relative to that crop.
 */
export function uncropQuad(bbox: OcrBoundingBox, rect: CropRect): OcrBoundingBox {
  return {
    points: bbox.points.map(([x, y]) => [x + rect.x, y + rect.y] as [number, number]),
  };
}
