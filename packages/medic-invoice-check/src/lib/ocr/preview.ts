// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
/**
 * Scan previews — the captured page kept around long enough for the review
 * screen to show it (docs/design.md §4.1).
 *
 * The OCR pipeline already knows *where* every recognised line sits: the
 * PaddleOCR adapter unions each line's region boxes into a quad and puts it on
 * `OcrResult.bbox` (`./engine`, `mapPaddleResult`). Until now nothing consumed
 * that geometry, because there was no image left to draw it on — the frame was
 * discarded the moment recognition finished. This module keeps a bounded,
 * downscaled copy of each rasterised page and provides the pure coordinate maths
 * that turns a source-image quad into preview-image pixels.
 *
 * **Privacy by design:** a preview is an in-memory {@link ImageData} and nothing
 * more. It is never persisted, never uploaded, and carries no identity of its
 * own; the review screen drops it when the scan is saved or abandoned
 * (docs/design.md §1.3, §8.2). Deliberately *not* a blob/object URL — those
 * outlive their creator unless revoked, which is a leak waiting to happen for
 * health data.
 */
import { downscale, makeImageData } from './preprocess';
import type { OcrBoundingBox, OcrResult } from './types';

/**
 * Longest edge, in pixels, a preview page is stored at. Big enough to re-read a
 * Ziffer or an amount when the user zooms in on a suspect line, small enough
 * that a multi-page document stays affordable (~4 MB RGBA at this size). The
 * frame handed to the detector is capped separately and much lower
 * (`DETECTION_MAX_SIDE_LENGTH` in `./engine`) — the preview is for human eyes,
 * not for inference.
 */
export const PREVIEW_MAX_SIDE = 1024;

/**
 * How many preview pages are retained per scan. A 40-page PDF would otherwise
 * pin ~160 MB of RGBA for the duration of the review; past this count the
 * remaining pages are simply not previewed (recognition still covers all of
 * them, so nothing is lost from the parse).
 */
export const PREVIEW_MAX_PAGES = 12;

/** One rasterised page, kept for display alongside its original dimensions. */
export interface PagePreview {
  /** Downscaled copy of the page, at most {@link PREVIEW_MAX_SIDE} on its long edge. */
  image: ImageData;
  /** Width of the frame OCR actually ran on — the coordinate space `bbox` uses. */
  sourceWidth: number;
  /** Height of the frame OCR actually ran on. */
  sourceHeight: number;
}

/** A recognised line located on a specific preview page. */
export interface PreviewLine {
  /** Index into {@link ScanPreview.pages}. */
  pageIndex: number;
  /** Index of this line in the scan's full `OcrResult[]` — the review screen's join key. */
  sourceLineIndex: number;
  /** The line's quad, already scaled into that page's preview pixel space. */
  points: Array<[number, number]>;
  text: string;
  confidence: number;
}

/** Every previewable page of one scan, plus its recognised lines. */
export interface ScanPreview {
  pages: PagePreview[];
  lines: PreviewLine[];
}

/** An axis-aligned rectangle in preview pixels. */
export interface QuadBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Copies `image` into a fresh buffer. Needed because {@link downscale} returns
 * its input *untouched* when the frame already fits — which would leave the
 * preview aliasing the very {@link ImageData} whose `data.buffer` the OCR client
 * transfers (zero-copy) to the worker, detaching it and blanking the preview.
 * A preview must own its pixels.
 */
function cloneImageData(image: ImageData): ImageData {
  return makeImageData(new Uint8ClampedArray(image.data), image.width, image.height);
}

/**
 * Builds the preview for one rasterised page. Call this **before** the frame is
 * handed to `preprocess`/`recognize`: the recognition path transfers the pixel
 * buffer out of the calling thread, so a copy taken afterwards may be empty.
 *
 * `sourceWidth`/`sourceHeight` record the dimensions the OCR coordinates refer
 * to, so {@link scaleQuadToPreview} can map between the two spaces regardless of
 * how far the preview was shrunk.
 */
export function createPagePreview(image: ImageData, maxSide = PREVIEW_MAX_SIDE): PagePreview {
  const scaled = downscale(image, maxSide);
  return {
    image: scaled === image ? cloneImageData(image) : scaled,
    sourceWidth: image.width,
    sourceHeight: image.height,
  };
}

/**
 * Maps a quad from source-image coordinates into `page`'s preview pixel space.
 * Both axes are scaled independently so a non-uniform downscale (possible after
 * rounding to whole pixels) still lands the box on its text. A degenerate source
 * size yields an empty quad rather than `Infinity` coordinates.
 */
export function scaleQuadToPreview(
  bbox: OcrBoundingBox,
  page: PagePreview,
): Array<[number, number]> {
  if (page.sourceWidth <= 0 || page.sourceHeight <= 0) return [];
  const scaleX = page.image.width / page.sourceWidth;
  const scaleY = page.image.height / page.sourceHeight;
  return bbox.points.map(([x, y]) => [x * scaleX, y * scaleY] as [number, number]);
}

/**
 * Smallest axis-aligned rectangle containing `points`, in the same space. Used
 * both to draw a highlight and to scroll a line into view. Returns a zero
 * rectangle for an empty quad — the shape PDF text-layer lines carry, which have
 * no geometry at all.
 */
export function quadBounds(points: ReadonlyArray<readonly [number, number]>): QuadBounds {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Half-open range `[start, end)` of line indices one preview page contributed.
 *
 * Explicit ranges rather than start-offsets alone: a document can interleave
 * previewable and non-previewable pages (a PDF whose page 1 has a usable text
 * layer and whose page 2 is a scan), and a bare offset list cannot express the
 * gap — every line of the text-layer page would be attributed to whichever
 * image page came before it.
 */
export interface PageLineRange {
  start: number;
  end: number;
}

/**
 * Which preview page a recognised line came from, or `-1` when it belongs to
 * none (a PDF text-layer page contributes lines but no image).
 *
 * Attribution by range — rather than a page field on `OcrResult` — keeps the
 * engine's result contract untouched, which matters because two synthetic
 * producers also emit `OcrResult` (the PDF text-layer reader and
 * `textToOcrResults`).
 */
export function pageIndexForLine(lineIndex: number, ranges: readonly PageLineRange[]): number {
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]!;
    if (lineIndex >= range.start && lineIndex < range.end) return i;
  }
  return -1;
}

/**
 * Assembles the review-screen preview from the pages that had an image and the
 * lines recognition returned. `ranges` is parallel to `pages`.
 *
 * Lines belonging to no preview page are dropped — there is nothing to draw them
 * on — so `ScanPreview.lines` is **not** index-aligned with `lines`. Each entry
 * therefore carries its own text and confidence, and
 * {@link findPreviewLineIndex} maps a scan line index onto it.
 */
export function buildScanPreview(
  pages: PagePreview[],
  lines: readonly OcrResult[],
  ranges: readonly PageLineRange[],
): ScanPreview {
  const previewLines: PreviewLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const pageIndex = pageIndexForLine(i, ranges);
    const page = pageIndex >= 0 ? pages[pageIndex] : undefined;
    if (!page) continue;
    previewLines.push({
      pageIndex,
      sourceLineIndex: i,
      points: scaleQuadToPreview(line.bbox, page),
      text: line.text,
      confidence: line.confidence,
    });
  }
  return { pages, lines: previewLines };
}

/**
 * Index into {@link ScanPreview.lines} for a given scan-line index, or `-1` when
 * that line has no preview. Lets the review screen light up the source line for
 * a position row, which carries the scan-line index (`ReviewPosition.lineIndex`).
 */
export function findPreviewLineIndex(preview: ScanPreview, sourceLineIndex: number): number {
  return preview.lines.findIndex((line) => line.sourceLineIndex === sourceLineIndex);
}
