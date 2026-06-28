// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';

import { renderPdfPage, type PdfJsLike, type RenderPdfDeps } from './pdf';

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
  const getDocument = vi.fn().mockReturnValue({ promise: Promise.resolve(doc) });
  const pdfjs: PdfJsLike = { getDocument, GlobalWorkerOptions: { workerSrc: '' } };
  return { pdfjs, getDocument, getPage, getViewport, render, doc };
}

function fakeCanvasDeps(pdfjs: PdfJsLike): {
  deps: RenderPdfDeps;
  getImageData: ReturnType<typeof vi.fn>;
  createCanvas: ReturnType<typeof vi.fn>;
} {
  const getImageData = vi.fn().mockReturnValue(sentinel);
  const context = { getImageData };
  const createCanvas = vi.fn().mockReturnValue({ getContext: () => context });
  return { deps: { loadPdfJs: async () => pdfjs, createCanvas }, getImageData, createCanvas };
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
    expect(getDocument).toHaveBeenCalledWith({ data: expect.any(Uint8Array) });
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

  it('sets a local worker source when provided', async () => {
    const { pdfjs } = fakePdfJs();
    const { deps } = fakeCanvasDeps(pdfjs);
    await renderPdfPage(pdfFile(), 1, { workerSrc: '/pdf.worker.js' }, deps);
    expect(pdfjs.GlobalWorkerOptions?.workerSrc).toBe('/pdf.worker.js');
  });

  it('throws for an out-of-range page', async () => {
    const { pdfjs } = fakePdfJs(1);
    const { deps } = fakeCanvasDeps(pdfjs);
    await expect(renderPdfPage(pdfFile(), 5, {}, deps)).rejects.toBeInstanceOf(RangeError);
  });

  it('throws when no 2D context is available', async () => {
    const { pdfjs } = fakePdfJs();
    const deps: RenderPdfDeps = {
      loadPdfJs: async () => pdfjs,
      createCanvas: () => ({ getContext: () => null }) as unknown as OffscreenCanvas,
    };
    await expect(renderPdfPage(pdfFile(), 1, {}, deps)).rejects.toThrow(/2D-Canvas-Kontext/);
  });
});
