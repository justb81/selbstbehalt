// SPDX-License-Identifier: Apache-2.0
/**
 * PDF → {@link ImageData} rendering, plus text-layer extraction, for the OCR
 * pipeline (docs/design.md §4.1, issues #25/#278). Many invoices arrive as a
 * PDF: a "digitally born" one (practice/billing software, "print to PDF")
 * carries a real text layer that `pdfjs` reads via `getTextContent()` in
 * milliseconds, deterministically and without OCR; a scanned one has no
 * usable text layer and still needs rasterisation so it can flow through the
 * same preprocessing (#25) and OCR worker (#24) as a photo. The decision is
 * made **per page** (see {@link extractOrRenderAllPdfPages}) — a single PDF
 * can mix both kinds.
 *
 * `pdfjs-dist` is heavy and DOM/worker-bound, so it is loaded through an
 * injectable lazy import and kept behind this seam — the orchestration is
 * unit-testable with a fake renderer, and no PDF bytes ever leave the device
 * (docs/design.md §1.3, §8).
 *
 * The pdf.js worker is created through Vite's worker pipeline (`?worker`) and
 * handed to pdf.js as a pre-created `PDFWorker` port — the same first-class
 * module-worker path the OCR worker uses. This deliberately avoids pdf.js's
 * built-in `new Worker(workerSrc)` / main-thread `import(workerSrc)` fallback,
 * whose content-hashed `.mjs` URL fails to load on mobile Chrome behind the
 * reverse-proxy Basic Auth (the "Setting up fake worker failed" error, #159).
 */

// `?worker`: Vite bundles the self-contained pdf.js worker into a hashed worker
// chunk (emitted under /_app/immutable/workers/, like the OCR worker) and gives
// us a constructor for it. We create one worker per render and tear it down in a
// `finally`, so there is no shared global worker state — pdf.js never terminates
// a caller-provided worker itself, so we own its lifecycle.
import PdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';

import type { OcrResult, ScanPage } from './types';

/**
 * One text run from pdf.js's `getTextContent()` — a `TextItem` (a
 * `TextMarkedContent` carries no `str`/`transform` and is filtered out).
 * `transform` is the glyph-space-to-page-space matrix `[a, b, c, d, e, f]`;
 * `e`/`f` are the run's x/y origin in PDF user space (origin bottom-left, y
 * grows upward).
 */
export interface PdfTextItemLike {
  str?: string;
  transform?: number[];
  width?: number;
}
export interface PdfTextContentLike {
  items: PdfTextItemLike[];
}

/** Minimal structural views of the pdf.js surface this module uses. */
export interface PdfPageLike {
  getViewport(options: { scale: number }): { width: number; height: number };
  render(options: {
    canvasContext: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }): { promise: Promise<void> };
  getTextContent(): Promise<PdfTextContentLike>;
}
export interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
}
export interface PdfLoadingTaskLike {
  promise: Promise<PdfDocumentLike>;
  destroy(): Promise<void>;
}
export interface PdfWorkerLike {
  destroy(): void;
}
export interface PdfJsLike {
  getDocument(src: { data: ArrayBuffer | Uint8Array; worker?: PdfWorkerLike }): PdfLoadingTaskLike;
  PDFWorker?: new (params: { port: Worker }) => PdfWorkerLike;
}

export interface RenderPdfDeps {
  /** Loads pdf.js; defaults to a lazy `import('pdfjs-dist')`. */
  loadPdfJs?: () => Promise<PdfJsLike>;
  /** Creates the pdf.js worker; defaults to the Vite-bundled module worker. */
  createPdfWorker?: () => Worker;
  /** Creates a render target canvas of the given size. */
  createCanvas?: (width: number, height: number) => HTMLCanvasElement | OffscreenCanvas;
}

export interface RenderPdfOptions {
  /** Render scale; higher means a sharper raster for OCR (default `2`). */
  scale?: number;
}

function defaultCreateCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== 'undefined') {
    return Object.assign(document.createElement('canvas'), { width, height });
  }
  return new OffscreenCanvas(width, height);
}

async function defaultLoadPdfJs(): Promise<PdfJsLike> {
  return (await import('pdfjs-dist')) as unknown as PdfJsLike;
}

function defaultCreatePdfWorker(): Worker {
  return new PdfjsWorker();
}

/**
 * Translates a `getDocument()` rejection into a clear, German, non-crashing
 * error (issue #278 — encrypted or corrupt PDFs must not blow up the scan
 * flow). Structural `name` check rather than `instanceof`: pdf.js's exception
 * classes aren't part of the {@link PdfJsLike} seam, so tests never need the
 * real library to exercise this path.
 */
function toPdfOpenError(err: unknown): Error {
  const name =
    typeof err === 'object' && err && 'name' in err ? String((err as { name: unknown }).name) : '';
  if (name === 'PasswordException') {
    return new Error('Die PDF-Datei ist passwortgeschützt und kann nicht gelesen werden.');
  }
  if (name === 'InvalidPDFException' || name === 'MissingPDFException') {
    return new Error('Die PDF-Datei ist beschädigt oder ungültig und kann nicht gelesen werden.');
  }
  return err instanceof Error ? err : new Error('Die PDF-Datei konnte nicht gelesen werden.');
}

/**
 * Opens a PDF with a dedicated pdf.js worker, runs `render`, and always tears the
 * worker and loading task down afterwards. Handing pdf.js a pre-created worker
 * port keeps it off its fragile `new Worker(workerSrc)` / fake-worker path; since
 * pdf.js only auto-terminates a worker it created itself, we own and terminate
 * the one we pass in.
 */
async function withPdfDocument<T>(
  file: Blob,
  deps: RenderPdfDeps,
  render: (doc: PdfDocumentLike) => Promise<T>,
): Promise<T> {
  const pdfjs = await (deps.loadPdfJs ?? defaultLoadPdfJs)();
  const createPdfWorker = deps.createPdfWorker ?? defaultCreatePdfWorker;

  const data = new Uint8Array(await file.arrayBuffer());
  const worker = createPdfWorker();
  const pdfWorker = pdfjs.PDFWorker ? new pdfjs.PDFWorker({ port: worker }) : undefined;
  const loadingTask = pdfjs.getDocument({ data, worker: pdfWorker });
  try {
    let doc: PdfDocumentLike;
    try {
      doc = await loadingTask.promise;
    } catch (err) {
      throw toPdfOpenError(err);
    }
    return await render(doc);
  } finally {
    // Tear down the transport first (swallow the benign "worker destroyed" /
    // "loading aborted" rejections destroy() can surface), then release the
    // worker we own — pdf.js will not terminate a caller-provided port.
    await loadingTask.destroy().catch(() => {});
    pdfWorker?.destroy();
    worker.terminate();
  }
}

async function renderPage(
  page: PdfPageLike,
  scale: number,
  createCanvas: (width: number, height: number) => HTMLCanvasElement | OffscreenCanvas,
): Promise<ImageData> {
  const viewport = page.getViewport({ scale });
  const width = Math.max(1, Math.ceil(viewport.width));
  const height = Math.max(1, Math.ceil(viewport.height));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d') as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new Error('Kein 2D-Canvas-Kontext zum Rendern des PDFs verfügbar.');
  await page.render({ canvasContext: context, viewport }).promise;
  return context.getImageData(0, 0, width, height);
}

/**
 * Renders every page of a PDF to an {@link ImageData} array (one entry per page,
 * in document order). Loads the document once and renders all pages sequentially.
 */
export async function renderAllPdfPages(
  file: Blob,
  options: RenderPdfOptions = {},
  deps: RenderPdfDeps = {},
): Promise<ImageData[]> {
  const createCanvas = deps.createCanvas ?? defaultCreateCanvas;
  const scale = options.scale ?? 2;
  return withPdfDocument(file, deps, async (doc) => {
    const images: ImageData[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      images.push(await renderPage(await doc.getPage(i), scale, createCanvas));
    }
    return images;
  });
}

/**
 * Renders one page of a PDF (1-based) to {@link ImageData}. Throws a `RangeError`
 * when the page is out of range.
 */
export async function renderPdfPage(
  file: Blob,
  pageNumber = 1,
  options: RenderPdfOptions = {},
  deps: RenderPdfDeps = {},
): Promise<ImageData> {
  const createCanvas = deps.createCanvas ?? defaultCreateCanvas;
  const scale = options.scale ?? 2;
  return withPdfDocument(file, deps, async (doc) => {
    if (pageNumber < 1 || pageNumber > doc.numPages) {
      throw new RangeError(`PDF-Seite ${pageNumber} existiert nicht (${doc.numPages} Seiten).`);
    }
    return renderPage(await doc.getPage(pageNumber), scale, createCanvas);
  });
}

// ---------------------------------------------------------------------------
// Text-layer extraction (issue #278)
// ---------------------------------------------------------------------------

/** A word-ish run positioned in PDF user-space, ready to be grouped into lines. */
interface PdfWord {
  text: string;
  x: number;
  endX: number;
  y: number;
}

/**
 * Rows within this many PDF user-space units of each other are treated as the
 * same text line — comfortably below real line spacing (a page's smallest
 * plausible font size), yet enough to absorb float jitter between glyphs that
 * share one baseline.
 */
const LINE_Y_TOLERANCE = 2;
/**
 * A horizontal gap between two runs larger than this (PDF user-space units)
 * inserts a space between them — kerned glyphs pdf.js splits into separate
 * runs sit closer together than an actual word boundary.
 */
const WORD_GAP_THRESHOLD = 1;

/**
 * Reconstructs reading-order lines from pdf.js's flat, unordered
 * `getTextContent()` item list: groups runs by their y-baseline (a row), then
 * sorts each row left-to-right by x. Grouping by baseline rather than reading
 * items in stream order also resolves multi-column layouts and tables — a row
 * only ever contains runs that actually share a baseline, wherever in the
 * column stream they were emitted.
 *
 * Returns {@link OcrResult}s at fixed `confidence: 1` so the existing
 * `goae-parser`/`scan-flow` consume them unchanged, exactly like real OCR
 * output.
 */
export function reconstructPdfTextLines(items: PdfTextItemLike[]): OcrResult[] {
  const words: PdfWord[] = [];
  for (const item of items) {
    const text = item.str;
    const transform = item.transform;
    if (!text || text.trim().length === 0 || !transform || transform.length < 6) continue;
    const x = transform[4] as number;
    const y = transform[5] as number;
    words.push({ text, x, endX: x + (item.width ?? 0), y });
  }
  if (words.length === 0) return [];

  const rows: PdfWord[][] = [];
  for (const word of words) {
    const row = rows.find((r) => Math.abs(r[0]!.y - word.y) <= LINE_Y_TOLERANCE);
    if (row) row.push(word);
    else rows.push([word]);
  }
  // Top of the page first — PDF user space has its origin at the bottom-left,
  // so y grows upward and the first line has the largest y.
  rows.sort((a, b) => b[0]!.y - a[0]!.y);

  return rows
    .map((row): OcrResult => {
      row.sort((a, b) => a.x - b.x);
      let text = '';
      let prevEndX: number | null = null;
      for (const word of row) {
        if (prevEndX !== null && word.x - prevEndX > WORD_GAP_THRESHOLD) text += ' ';
        text += word.text;
        prevEndX = word.endX;
      }
      return { text: text.trim(), bbox: { points: [] }, confidence: 1 };
    })
    .filter((line) => line.text.length > 0);
}

/** Minimum non-whitespace characters a page's text layer must carry to be considered real content. */
const MIN_TEXT_LAYER_CHARS = 40;
/** Below this printable-character ratio, the text layer is treated as garbled (bad CID/ligature font). */
const MIN_PRINTABLE_RATIO = 0.85;
/** Control characters, the Unicode replacement character, and the Private Use Area (common CID-font garbage). */
// eslint-disable-next-line no-control-regex -- deliberately matching control chars to detect a garbled text layer
const UNPRINTABLE_CHAR_RE = /[\uFFFD\uE000-\uF8FF\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
/** A plausible GOÄ/GOZ/GOT Ziffer: 1–5 digits, optionally followed by a letter suffix. */
const ZIFFER_TOKEN_RE = /\b\d{1,5}[a-zA-Z]?\b/;
/** A Euro amount marker. */
const CURRENCY_TOKEN_RE = /€|\bEUR\b/;
/** A German date, e.g. "07.05.2024". */
const DATE_TOKEN_RE = /\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/;

/**
 * Quality/usability heuristic (issue #278) deciding text-layer vs. OCR for one
 * page: enough non-whitespace content, a high enough printable-character
 * ratio (rules out a garbled CID/ligature font that "extracts" as control
 * characters or Private-Use-Area junk), and at least one token an invoice
 * page should plausibly contain (a GOÄ/GOZ/GOT Ziffer, a Euro amount, or a
 * date) — a fake/garbled text layer typically fails all three even when its
 * characters are individually printable.
 */
export function isUsableTextLayer(lines: OcrResult[]): boolean {
  const text = lines.map((l) => l.text).join('\n');
  const nonWhitespaceLength = text.replace(/\s/g, '').length;
  if (nonWhitespaceLength < MIN_TEXT_LAYER_CHARS) return false;

  const badChars = text.match(UNPRINTABLE_CHAR_RE)?.length ?? 0;
  if (badChars / text.length > 1 - MIN_PRINTABLE_RATIO) return false;

  return ZIFFER_TOKEN_RE.test(text) && (CURRENCY_TOKEN_RE.test(text) || DATE_TOKEN_RE.test(text));
}

/**
 * Reads one PDF page's text layer (no rasterisation, no OCR) — `getTextContent()`
 * plus {@link reconstructPdfTextLines}. Throws a `RangeError` when the page is
 * out of range, same as {@link renderPdfPage}.
 */
export async function extractPdfPageLines(
  file: Blob,
  pageNumber = 1,
  deps: RenderPdfDeps = {},
): Promise<OcrResult[]> {
  return withPdfDocument(file, deps, async (doc) => {
    if (pageNumber < 1 || pageNumber > doc.numPages) {
      throw new RangeError(`PDF-Seite ${pageNumber} existiert nicht (${doc.numPages} Seiten).`);
    }
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    return reconstructPdfTextLines(content.items);
  });
}

/**
 * Reads every page of a PDF, preferring each page's text layer and falling
 * back to rasterisation only for the pages whose text layer is missing or
 * unusable (issue #278 — encrypted-looking garbage, a scanned page with no
 * text layer at all, …). The document is opened once and walked page by page
 * in order; the decision is independent per page, so one PDF can freely mix
 * digitally-born and scanned pages.
 */
export async function extractOrRenderAllPdfPages(
  file: Blob,
  options: RenderPdfOptions = {},
  deps: RenderPdfDeps = {},
): Promise<ScanPage[]> {
  const createCanvas = deps.createCanvas ?? defaultCreateCanvas;
  const scale = options.scale ?? 2;
  return withPdfDocument(file, deps, async (doc) => {
    const pages: ScanPage[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const lines = reconstructPdfTextLines(content.items);
      if (isUsableTextLayer(lines)) {
        pages.push({ kind: 'text', lines });
      } else {
        pages.push({ kind: 'image', image: await renderPage(page, scale, createCanvas) });
      }
    }
    return pages;
  });
}
