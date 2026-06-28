// SPDX-License-Identifier: Apache-2.0
/**
 * PDF → {@link ImageData} rendering for the OCR pipeline (docs/design.md §4.1,
 * issue #25). Many invoices arrive as a PDF; this rasterises a chosen page so it
 * can flow through the same preprocessing (#25) and OCR worker (#24) as a photo.
 *
 * `pdfjs-dist` is heavy and DOM/worker-bound, so it is loaded through an
 * injectable lazy import and kept behind this seam — the orchestration is
 * unit-testable with a fake renderer, and no PDF bytes ever leave the device
 * (docs/design.md §1.3, §8). The default loader wires the bundled worker via a
 * static `?url` import so Vite emits it as a content-hashed build asset at
 * compile time; callers may override it via `RenderPdfOptions.workerSrc`.
 */

// Static `?url` import: Vite resolves the package path at build time, emits
// the worker as a content-hashed asset, and returns the correct served URL.
// A dynamic `await import('...?url')` inside an async function is less
// reliable in Rollup production builds — the asset may not be emitted.
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/** Minimal structural views of the pdf.js surface this module uses. */
export interface PdfPageLike {
  getViewport(options: { scale: number }): { width: number; height: number };
  render(options: {
    canvasContext: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }): { promise: Promise<void> };
}
export interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
}
export interface PdfJsLike {
  getDocument(src: { data: ArrayBuffer | Uint8Array }): { promise: Promise<PdfDocumentLike> };
  GlobalWorkerOptions?: { workerSrc: string };
}

export interface RenderPdfDeps {
  /** Loads pdf.js; defaults to a lazy `import('pdfjs-dist')` with worker wired. */
  loadPdfJs?: () => Promise<PdfJsLike>;
  /** Creates a render target canvas of the given size. */
  createCanvas?: (width: number, height: number) => HTMLCanvasElement | OffscreenCanvas;
}

export interface RenderPdfOptions {
  /** Render scale; higher means a sharper raster for OCR (default `2`). */
  scale?: number;
  /** Local pdf.js worker URL; set to keep the worker on-device. */
  workerSrc?: string;
}

function defaultCreateCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== 'undefined') {
    return Object.assign(document.createElement('canvas'), { width, height });
  }
  return new OffscreenCanvas(width, height);
}

async function defaultLoadPdfJs(): Promise<PdfJsLike> {
  const pdfjs = await import('pdfjs-dist');
  if (pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  }
  return pdfjs as unknown as PdfJsLike;
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
  const loadPdfJs = deps.loadPdfJs ?? defaultLoadPdfJs;
  const createCanvas = deps.createCanvas ?? defaultCreateCanvas;
  const scale = options.scale ?? 2;

  const pdfjs = await loadPdfJs();
  if (options.workerSrc && pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = options.workerSrc;
  }

  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  if (pageNumber < 1 || pageNumber > doc.numPages) {
    throw new RangeError(`PDF-Seite ${pageNumber} existiert nicht (${doc.numPages} Seiten).`);
  }

  const page = await doc.getPage(pageNumber);
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
