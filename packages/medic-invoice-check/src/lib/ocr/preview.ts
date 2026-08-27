// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
/**
 * Scan previews — the captured page kept around long enough for the review
 * screen to show it (docs/architecture.md §6.1).
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
 * (docs/architecture.md §2.2, §8.1). Deliberately *not* a blob/object URL — those
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
 * How many **rasterised** pages are retained per scan. A 40-page scan-PDF would
 * otherwise pin ~160 MB of RGBA for the duration of the review; past this count
 * the remaining image pages are simply not previewed (recognition still covers
 * all of them, so nothing is lost from the parse).
 *
 * Text-layer pages are not counted against this: a {@link TextPagePreview} holds
 * no pixels, so a 40-page digitally-born PDF gets all 40 entries.
 */
export const PREVIEW_MAX_PAGES = 12;

/** What both page kinds carry: where the page sat in the scanned document. */
interface PagePreviewBase {
  /**
   * 1-based position of this page in the scanned document — every selected file
   * flattened into one page sequence (`filesToAllPages`). Carried explicitly
   * because the preview list is *not* the document: an image page past
   * {@link PREVIEW_MAX_PAGES} gets no entry at all, so an index into
   * {@link ScanPreview.pages} is not a page number (issue #362).
   */
  documentPage: number;
}

/** One rasterised page, kept for display alongside its original dimensions. */
export interface ImagePagePreview extends PagePreviewBase {
  kind: 'image';
  /** Downscaled copy of the page, at most {@link PREVIEW_MAX_SIDE} on its long edge. */
  image: ImageData;
  /** Width of the frame OCR actually ran on — the coordinate space `bbox` uses. */
  sourceWidth: number;
  /** Height of the frame OCR actually ran on. */
  sourceHeight: number;
}

/**
 * A page read from a PDF's text layer (issue #278): lines but deliberately no
 * pixels — rasterising it purely to have something to show would throw away the
 * whole speed advantage of the text-layer path, which is the *better* path
 * (exact text instead of OCR guesswork).
 *
 * It exists in the preview so its lines are attributed to **it** and listed,
 * rather than silently dropped — without an entry the review screen showed a
 * text-layer document as if recognition had found nothing (issue #362).
 */
export interface TextPagePreview extends PagePreviewBase {
  kind: 'text';
}

/** One page of a scan, as the review screen shows it. */
export type PagePreview = ImagePagePreview | TextPagePreview;

/** Narrows a {@link PagePreview} to the variant carrying pixels (usable as a filter predicate). */
export function isImagePagePreview(page: PagePreview): page is ImagePagePreview {
  return page.kind === 'image';
}

/** A recognised line located on a specific preview page. */
export interface PreviewLine {
  /** Index into {@link ScanPreview.pages}. */
  pageIndex: number;
  /** Index of this line in the scan's full `OcrResult[]` — the review screen's join key. */
  sourceLineIndex: number;
  /**
   * The line's quad, already scaled into that page's preview pixel space. Empty
   * for a line on a {@link TextPagePreview}: there is no image to place it on,
   * and a PDF text-layer line carries no geometry to begin with.
   */
  points: Array<[number, number]>;
  text: string;
  confidence: number;
}

/** Every previewable page of one scan, plus its recognised lines. */
export interface ScanPreview {
  /** The previewable pages, in document order. */
  pages: PagePreview[];
  lines: PreviewLine[];
  /**
   * Pages the scan covered in total, previewed or not, so the pager can name the
   * page the user is looking at ("Seite 2 von 5") instead of its index in a list
   * that may have skipped some. Not derivable from the entries: when the tail of
   * a document is truncated by {@link PREVIEW_MAX_PAGES}, the highest
   * {@link PagePreviewBase.documentPage} present is lower than the real count.
   */
  documentPageCount: number;
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

/** Where a page sat in the document, and how far its preview may be shrunk. */
export interface CreatePagePreviewOptions {
  /** 1-based page number in the scanned document (see {@link PagePreviewBase.documentPage}). */
  documentPage: number;
  /** Longest edge of the stored copy; defaults to {@link PREVIEW_MAX_SIDE}. */
  maxSide?: number;
}

/**
 * Builds the preview for one rasterised page. Call this **before** the frame is
 * handed to `preprocess`/`recognize`: the recognition path transfers the pixel
 * buffer out of the calling thread, so a copy taken afterwards may be empty.
 *
 * `sourceWidth`/`sourceHeight` record the dimensions the OCR coordinates refer
 * to, so {@link scaleQuadToPreview} can map between the two spaces regardless of
 * how far the preview was shrunk.
 *
 * `options` is an object rather than positional parameters so that a page number
 * can never be mistaken for a `maxSide` (or the reverse) at a call site.
 */
export function createPagePreview(
  image: ImageData,
  options: CreatePagePreviewOptions,
): ImagePagePreview {
  const scaled = downscale(image, options.maxSide ?? PREVIEW_MAX_SIDE);
  return {
    kind: 'image',
    documentPage: options.documentPage,
    image: scaled === image ? cloneImageData(image) : scaled,
    sourceWidth: image.width,
    sourceHeight: image.height,
  };
}

/**
 * The preview entry for a page read from a PDF's text layer: a page number and
 * nothing else, because there are no pixels to keep (see
 * {@link TextPagePreview}).
 */
export function createTextPagePreview(documentPage: number): TextPagePreview {
  return { kind: 'text', documentPage };
}

/**
 * Maps a quad from source-image coordinates into `page`'s preview pixel space.
 * Both axes are scaled independently so a non-uniform downscale (possible after
 * rounding to whole pixels) still lands the box on its text. A degenerate source
 * size yields an empty quad rather than `Infinity` coordinates.
 */
export function scaleQuadToPreview(
  bbox: OcrBoundingBox,
  page: ImagePagePreview,
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
 * previewable and non-previewable pages — an image page past
 * {@link PREVIEW_MAX_PAGES} still contributes lines but has no entry — and a bare
 * offset list cannot express the gap, so those lines would be attributed to
 * whichever page came before them.
 */
export interface PageLineRange {
  start: number;
  end: number;
}

/**
 * Which preview page a recognised line came from, or `-1` when it belongs to
 * none — an image page beyond {@link PREVIEW_MAX_PAGES}, whose pixels were not
 * kept and which therefore has no entry to attribute lines to.
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
 * Assembles the review-screen preview from the pages that got an entry and the
 * lines recognition returned. `ranges` is parallel to `pages`.
 *
 * A text-layer page's lines are kept even though it has no image to draw them
 * on: they get an empty quad and are shown in the accessible line list, which is
 * what the page's own recognised text *is* (issue #362). Only lines belonging to
 * no page at all are dropped — an image page past {@link PREVIEW_MAX_PAGES} — so
 * `ScanPreview.lines` is still **not** index-aligned with `lines`. Each entry
 * therefore carries its own text and confidence, and
 * {@link findPreviewLineIndex} maps a scan line index onto it.
 */
export function buildScanPreview(
  pages: PagePreview[],
  lines: readonly OcrResult[],
  ranges: readonly PageLineRange[],
  documentPageCount: number,
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
      points: page.kind === 'image' ? scaleQuadToPreview(line.bbox, page) : [],
      text: line.text,
      confidence: line.confidence,
    });
  }
  return { pages, lines: previewLines, documentPageCount };
}

/**
 * Index into {@link ScanPreview.lines} for a given scan-line index, or `-1` when
 * that line has no preview. Lets the review screen light up the source line for
 * a position row, which carries the scan-line index (`ReviewPosition.lineIndex`).
 */
export function findPreviewLineIndex(preview: ScanPreview, sourceLineIndex: number): number {
  return preview.lines.findIndex((line) => line.sourceLineIndex === sourceLineIndex);
}
