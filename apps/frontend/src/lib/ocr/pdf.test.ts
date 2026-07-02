// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';

import { renderAllPdfPages, renderPdfPage, type PdfJsLike, type RenderPdfDeps } from './pdf';

const sentinel = { data: new Uint8ClampedArray(4), width: 1, height: 1 } as unknown as ImageData;

function fakePdfJs(numPages = 2) {
  const render = vi.fn().mockReturnValue({ promise: Promise.resolve() });
  const getViewport = vi.fn(({ scale }: { scale: number }) => ({
    width: 100 * scale,
    height: 50 * scale,
  }));
  const page = { getViewport, render };
  const getPage = vi.fn().mockResolvedValue(page);
  const doc = { numPages, getPage };
  const destroy = vi.fn().mockResolvedValue(undefined);
  const getDocument = vi.fn().mockReturnValue({ promise: Promise.resolve(doc), destroy });
  const pdfWorkerDestroy = vi.fn();
  const PDFWorker = vi.fn(
    class {
      destroy = pdfWorkerDestroy;
    },
  );
  const pdfjs: PdfJsLike = {
    getDocument,
    PDFWorker: PDFWorker as unknown as PdfJsLike['PDFWorker'],
  };
  return {
    pdfjs,
    getDocument,
    getPage,
    getViewport,
    render,
    doc,
    destroy,
    PDFWorker,
    pdfWorkerDestroy,
  };
}

function fakeCanvasDeps(pdfjs: PdfJsLike): {
  deps: RenderPdfDeps;
  getImageData: ReturnType<typeof vi.fn>;
  createCanvas: ReturnType<typeof vi.fn>;
  createPdfWorker: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
} {
  const getImageData = vi.fn().mockReturnValue(sentinel);
  const context = { getImageData };
  const createCanvas = vi.fn().mockReturnValue({ getContext: () => context });
  const terminate = vi.fn();
  const createPdfWorker = vi.fn(() => ({ terminate }) as unknown as Worker);
  return {
    deps: { loadPdfJs: async () => pdfjs, createCanvas, createPdfWorker },
    getImageData,
    createCanvas,
    createPdfWorker,
    terminate,
  };
}

function pdfFile(): Blob {
  return new File([new Uint8Array([1, 2, 3])], 'invoice.pdf', { type: 'application/pdf' });
}

describe('renderPdfPage', () => {
  it('renders the first page at the default scale into ImageData', async () => {
    const { pdfjs, getDocument, getPage, getViewport } = fakePdfJs();
    const { deps, createCanvas, getImageData } = fakeCanvasDeps(pdfjs);
    const result = await renderPdfPage(pdfFile(), 1, {}, deps);
    expect(result).toBe(sentinel);
    expect(getDocument).toHaveBeenCalledWith({
      data: expect.any(Uint8Array),
      worker: expect.objectContaining({ destroy: expect.any(Function) }),
    });
    expect(getPage).toHaveBeenCalledWith(1);
    expect(getViewport).toHaveBeenCalledWith({ scale: 2 });
    expect(createCanvas).toHaveBeenCalledWith(200, 100);
    expect(getImageData).toHaveBeenCalledWith(0, 0, 200, 100);
  });

  it('honours a custom scale', async () => {
    const { pdfjs, getViewport } = fakePdfJs();
    const { deps, createCanvas } = fakeCanvasDeps(pdfjs);
    await renderPdfPage(pdfFile(), 1, { scale: 3 }, deps);
    expect(getViewport).toHaveBeenCalledWith({ scale: 3 });
    expect(createCanvas).toHaveBeenCalledWith(300, 150);
  });

  it('creates a dedicated worker per call and tears it down afterwards', async () => {
    const { pdfjs, destroy, PDFWorker, pdfWorkerDestroy } = fakePdfJs();
    const { deps, createPdfWorker, terminate } = fakeCanvasDeps(pdfjs);
    await renderPdfPage(pdfFile(), 1, {}, deps);
    expect(createPdfWorker).toHaveBeenCalledTimes(1);
    expect(PDFWorker).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1); // loadingTask.destroy()
    expect(pdfWorkerDestroy).toHaveBeenCalledTimes(1);
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('throws for an out-of-range page and still tears the worker down', async () => {
    const { pdfjs } = fakePdfJs(1);
    const { deps, terminate } = fakeCanvasDeps(pdfjs);
    await expect(renderPdfPage(pdfFile(), 5, {}, deps)).rejects.toBeInstanceOf(RangeError);
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('throws when no 2D context is available', async () => {
    const { pdfjs } = fakePdfJs();
    const deps: RenderPdfDeps = {
      loadPdfJs: async () => pdfjs,
      createPdfWorker: () => ({ terminate: vi.fn() }) as unknown as Worker,
      createCanvas: () => ({ getContext: () => null }) as unknown as OffscreenCanvas,
    };
    await expect(renderPdfPage(pdfFile(), 1, {}, deps)).rejects.toThrow(/2D-Canvas-Kontext/);
  });
});

describe('renderAllPdfPages', () => {
  it('renders every page and returns one ImageData per page', async () => {
    const { pdfjs, getPage } = fakePdfJs(3);
    const sentinels = [sentinel, sentinel, sentinel];
    let callCount = 0;
    const getImageData = vi.fn().mockImplementation(() => sentinels[callCount++]);
    const context = { getImageData };
    const createCanvas = vi.fn().mockReturnValue({ getContext: () => context });
    const deps: RenderPdfDeps = {
      loadPdfJs: async () => pdfjs,
      createPdfWorker: () => ({ terminate: vi.fn() }) as unknown as Worker,
      createCanvas,
    };

    const results = await renderAllPdfPages(pdfFile(), {}, deps);
    expect(results).toHaveLength(3);
    expect(getPage).toHaveBeenNthCalledWith(1, 1);
    expect(getPage).toHaveBeenNthCalledWith(2, 2);
    expect(getPage).toHaveBeenNthCalledWith(3, 3);
    expect(getImageData).toHaveBeenCalledTimes(3);
  });

  it('returns a single-element array for a one-page PDF', async () => {
    const { pdfjs } = fakePdfJs(1);
    const { deps } = fakeCanvasDeps(pdfjs);
    const results = await renderAllPdfPages(pdfFile(), {}, deps);
    expect(results).toHaveLength(1);
    expect(results[0]).toBe(sentinel);
  });

  it('honours scale via options', async () => {
    const { pdfjs, getViewport } = fakePdfJs(1);
    const { deps } = fakeCanvasDeps(pdfjs);
    await renderAllPdfPages(pdfFile(), { scale: 3 }, deps);
    expect(getViewport).toHaveBeenCalledWith({ scale: 3 });
  });
});
