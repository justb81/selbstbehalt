// SPDX-License-Identifier: Apache-2.0
/**
 * PDF → {@link ImageData} rendering for the OCR pipeline (docs/design.md §4.1,
 * issue #25). Many invoices arrive as a PDF; this rasterises a chosen page so it
 * can flow through the same preprocessing (#25) and OCR worker (#24) as a photo.
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
    const doc = await loadingTask.promise;
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
  doc: PdfDocumentLike,
  pageNumber: number,
  scale: number,
  createCanvas: (width: number, height: number) => HTMLCanvasElement | OffscreenCanvas,
): Promise<ImageData> {
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
      images.push(await renderPage(doc, i, scale, createCanvas));
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
    return renderPage(doc, pageNumber, scale, createCanvas);
  });
}
