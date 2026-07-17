// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';

import {
  extractOrRenderAllPdfPages,
  extractPdfPageLines,
  isUsableTextLayer,
  reconstructPdfTextLines,
  renderAllPdfPages,
  renderPdfPage,
  type PdfJsLike,
  type PdfTextItemLike,
  type RenderPdfDeps,
} from './pdf';
import type { OcrResult } from './types';

const sentinel = { data: new Uint8ClampedArray(4), width: 1, height: 1 } as unknown as ImageData;

function fakePdfJs(numPages = 2, textContent: { items: PdfTextItemLike[] } = { items: [] }) {
  const render = vi.fn().mockReturnValue({ promise: Promise.resolve() });
  const getViewport = vi.fn(({ scale }: { scale: number }) => ({
    width: 100 * scale,
    height: 50 * scale,
  }));
  const getTextContent = vi.fn().mockResolvedValue(textContent);
  const page = { getViewport, render, getTextContent };
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
    getTextContent,
    render,
    page,
    doc,
    destroy,
    PDFWorker,
    pdfWorkerDestroy,
  };
}

/**
 * A `fakePdfJs` variant whose pages carry distinct text content, so
 * per-page fallback decisions ({@link extractOrRenderAllPdfPages}) can be
 * exercised: page `i` (1-based) gets `pagesTextContent[i - 1]`.
 */
function fakeMultiPagePdfJs(pagesTextContent: Array<{ items: PdfTextItemLike[] }>) {
  const render = vi.fn().mockReturnValue({ promise: Promise.resolve() });
  const getViewport = vi.fn(({ scale }: { scale: number }) => ({
    width: 100 * scale,
    height: 50 * scale,
  }));
  const pages = pagesTextContent.map((textContent) => ({
    getViewport,
    render,
    getTextContent: vi.fn().mockResolvedValue(textContent),
  }));
  const getPage = vi.fn((pageNumber: number) => Promise.resolve(pages[pageNumber - 1]));
  const doc = { numPages: pages.length, getPage };
  const destroy = vi.fn().mockResolvedValue(undefined);
  const getDocument = vi.fn().mockReturnValue({ promise: Promise.resolve(doc), destroy });
  const pdfjs: PdfJsLike = { getDocument };
  return { pdfjs, getPage, getViewport, render, pages, doc, destroy };
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

/** A text run at PDF user-space position `(x, y)`, with an optional width for gap math. */
function run(str: string, x: number, y: number, width = 0): PdfTextItemLike {
  return { str, transform: [1, 0, 0, 1, x, y], width };
}

describe('reconstructPdfTextLines', () => {
  it('groups runs sharing a y-baseline into one line, sorted left to right', () => {
    // Deliberately out of reading order and unsorted within the row.
    const items = [
      run('5,36', 230, 680, 20),
      run('Blutentnahme', 80, 680, 60),
      run('Rechnungsdatum:', 50, 700, 90),
      run('250', 50, 680, 20),
      run('2,3', 200, 680, 15),
      run('15.03.2026', 150, 700, 50),
    ];
    const lines = reconstructPdfTextLines(items);
    expect(lines.map((l) => l.text)).toEqual([
      'Rechnungsdatum: 15.03.2026',
      '250 Blutentnahme 2,3 5,36',
    ]);
    expect(lines.every((l) => l.confidence === 1)).toBe(true);
    expect(lines.every((l) => l.bbox.points.length === 0)).toBe(true);
  });

  it('joins a kerned split without an extra space when runs sit flush together', () => {
    // "Rechnung" split into two runs with essentially no gap between them.
    const items = [run('Rec', 50, 700, 15), run('hnung', 65, 700, 30)];
    const lines = reconstructPdfTextLines(items);
    expect(lines).toEqual([{ text: 'Rechnung', bbox: { points: [] }, confidence: 1 }]);
  });

  it('inserts a space across a real word gap even without an explicit separator', () => {
    const items = [run('250', 50, 680, 20), run('Blutentnahme', 80, 680, 60)];
    const lines = reconstructPdfTextLines(items);
    expect(lines[0]?.text).toBe('250 Blutentnahme');
  });

  it('ignores whitespace-only and malformed items', () => {
    const items: PdfTextItemLike[] = [
      run('250', 50, 680, 20),
      { str: '   ', transform: [1, 0, 0, 1, 90, 680] },
      { str: 'x' }, // no transform
      { transform: [1, 0, 0, 1, 10, 10] }, // no str
    ];
    const lines = reconstructPdfTextLines(items);
    expect(lines).toEqual([{ text: '250', bbox: { points: [] }, confidence: 1 }]);
  });

  it('returns an empty array for a page with no text runs', () => {
    expect(reconstructPdfTextLines([])).toEqual([]);
  });

  it('resolves a two-column layout by baseline, not stream order', () => {
    // Two columns printed in file order left-column-then-right-column per row
    // would otherwise interleave; grouping by y keeps each row intact.
    const items = [
      run('Leistung', 50, 700, 60),
      run('Betrag', 300, 700, 40),
      run('Blutentnahme', 50, 680, 70),
      run('5,36', 300, 680, 30),
    ];
    const lines = reconstructPdfTextLines(items);
    expect(lines.map((l) => l.text)).toEqual(['Leistung Betrag', 'Blutentnahme 5,36']);
  });
});

/** Builds `count` filler lines of real invoice-shaped text at distinct y positions. */
function invoiceLines(...texts: string[]): OcrResult[] {
  return texts.map((text) => ({ text, bbox: { points: [] }, confidence: 1 }));
}

describe('isUsableTextLayer', () => {
  it('accepts a real invoice text layer (Ziffer + Betrag + date)', () => {
    expect(
      isUsableTextLayer(
        invoiceLines(
          'Rechnungsdatum: 15.03.2026',
          '250  Blutentnahme  2,3  5,36 EUR',
          '75  Bericht  3,5  26,53 EUR',
        ),
      ),
    ).toBe(true);
  });

  it('rejects a page with too little content (near-blank page)', () => {
    expect(isUsableTextLayer(invoiceLines('Seite 2'))).toBe(false);
  });

  it('rejects a page with no expected invoice tokens, even if long enough', () => {
    const prose =
      'Dies ist ein langer Fließtext ohne jede Rechnungsstruktur der nur zur Fuellung dient';
    expect(isUsableTextLayer(invoiceLines(prose))).toBe(false);
  });

  it('rejects a garbled CID/ligature-font text layer (Private-Use-Area junk)', () => {
    const junk = Array.from({ length: 60 }, (_, i) => String.fromCodePoint(0xe000 + i)).join('');
    expect(isUsableTextLayer(invoiceLines(junk, '123', '€'))).toBe(false);
  });

  it('accepts a page whose Ziffer + currency tokens are spread across several lines', () => {
    expect(
      isUsableTextLayer(
        invoiceLines('Zahnarztpraxis Dr. Mustermann', 'Ziffer 250', 'Betrag 5,36 €'),
      ),
    ).toBe(true);
  });
});

describe('extractPdfPageLines', () => {
  it('reads a text layer without rendering or OCR', async () => {
    const items = [run('250', 50, 680, 20), run('Blutentnahme', 80, 680, 60)];
    const { pdfjs, getPage, render } = fakePdfJs(1, { items });
    const { deps } = fakeCanvasDeps(pdfjs);
    const lines = await extractPdfPageLines(pdfFile(), 1, deps);
    expect(lines).toEqual([{ text: '250 Blutentnahme', bbox: { points: [] }, confidence: 1 }]);
    expect(getPage).toHaveBeenCalledWith(1);
    expect(render).not.toHaveBeenCalled();
  });

  it('throws for an out-of-range page and still tears the worker down', async () => {
    const { pdfjs } = fakePdfJs(1);
    const { deps, terminate } = fakeCanvasDeps(pdfjs);
    await expect(extractPdfPageLines(pdfFile(), 5, deps)).rejects.toBeInstanceOf(RangeError);
    expect(terminate).toHaveBeenCalledTimes(1);
  });
});

describe('extractOrRenderAllPdfPages', () => {
  it('reads a usable text layer without rasterising that page', async () => {
    const items = [
      run('Rechnungsdatum:', 50, 700, 90),
      run('15.03.2026', 150, 700, 50),
      run('250', 50, 680, 20),
      run('Blutentnahme', 80, 680, 60),
      run('2,3', 200, 680, 15),
      run('5,36', 230, 680, 20),
      run('EUR', 260, 680, 20),
    ];
    const { pdfjs, render } = fakeMultiPagePdfJs([{ items }]);
    const { deps } = fakeCanvasDeps(pdfjs);
    const pages = await extractOrRenderAllPdfPages(pdfFile(), {}, deps);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.kind).toBe('text');
    expect(render).not.toHaveBeenCalled();
    if (pages[0]?.kind === 'text') {
      expect(pages[0].lines.map((l) => l.text)).toEqual([
        'Rechnungsdatum: 15.03.2026',
        '250 Blutentnahme 2,3 5,36 EUR',
      ]);
    }
  });

  it('falls back to rasterisation for a page with no text layer (scanned page)', async () => {
    const { pdfjs, render } = fakeMultiPagePdfJs([{ items: [] }]);
    const { deps, getImageData } = fakeCanvasDeps(pdfjs);
    const pages = await extractOrRenderAllPdfPages(pdfFile(), {}, deps);
    expect(pages).toEqual([{ kind: 'image', image: sentinel }]);
    expect(render).toHaveBeenCalledTimes(1);
    expect(getImageData).toHaveBeenCalledTimes(1);
  });

  it('falls back for a page whose text layer is garbled (CID-font junk)', async () => {
    const junkItems = Array.from({ length: 60 }, (_, i) =>
      run(String.fromCodePoint(0xe000 + i), i, 700),
    );
    const { pdfjs, render } = fakeMultiPagePdfJs([{ items: junkItems }]);
    const { deps } = fakeCanvasDeps(pdfjs);
    const pages = await extractOrRenderAllPdfPages(pdfFile(), {}, deps);
    expect(pages[0]?.kind).toBe('image');
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('mixes text and image pages within one PDF, deciding per page', async () => {
    const textPageItems = [
      run('Rechnungsdatum:', 50, 700, 90),
      run('15.03.2026', 150, 700, 50),
      run('250', 50, 680, 20),
      run('Blutentnahme', 80, 680, 60),
      run('2,3', 200, 680, 15),
      run('5,36 EUR', 230, 680, 40),
      run('75', 50, 660, 15),
      run('Bericht', 75, 660, 45),
      run('3,5', 130, 660, 15),
      run('26,53 EUR', 155, 660, 45),
    ];
    const { pdfjs, render } = fakeMultiPagePdfJs([{ items: textPageItems }, { items: [] }]);
    const { deps } = fakeCanvasDeps(pdfjs);
    const pages = await extractOrRenderAllPdfPages(pdfFile(), {}, deps);
    expect(pages).toHaveLength(2);
    expect(pages[0]?.kind).toBe('text');
    expect(pages[1]?.kind).toBe('image');
    expect(render).toHaveBeenCalledTimes(1); // only the scanned page was rasterised
  });

  it('honours scale for the pages that do fall back to rasterisation', async () => {
    const { pdfjs, getViewport } = fakeMultiPagePdfJs([{ items: [] }]);
    const { deps } = fakeCanvasDeps(pdfjs);
    await extractOrRenderAllPdfPages(pdfFile(), { scale: 3 }, deps);
    expect(getViewport).toHaveBeenCalledWith({ scale: 3 });
  });
});

describe('encrypted / corrupt PDF handling', () => {
  function rejectingPdfJs(name: string) {
    const err = Object.assign(new Error('pdf.js internal'), { name });
    const destroy = vi.fn().mockResolvedValue(undefined);
    const getDocument = vi.fn().mockReturnValue({ promise: Promise.reject(err), destroy });
    const pdfjs: PdfJsLike = { getDocument };
    return { pdfjs, destroy };
  }

  it('surfaces a clear message for a password-protected PDF instead of crashing', async () => {
    const { pdfjs, destroy } = rejectingPdfJs('PasswordException');
    const { deps, terminate } = fakeCanvasDeps(pdfjs);
    await expect(renderPdfPage(pdfFile(), 1, {}, deps)).rejects.toThrow(/passwortgeschützt/);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('surfaces a clear message for a corrupt/invalid PDF instead of crashing', async () => {
    const { pdfjs } = rejectingPdfJs('InvalidPDFException');
    const { deps } = fakeCanvasDeps(pdfjs);
    await expect(extractPdfPageLines(pdfFile(), 1, deps)).rejects.toThrow(/beschädigt/);
  });

  it('falls back to the original error message for an unrecognised failure', async () => {
    const { pdfjs } = rejectingPdfJs('SomeOtherError');
    const { deps } = fakeCanvasDeps(pdfjs);
    await expect(extractOrRenderAllPdfPages(pdfFile(), {}, deps)).rejects.toThrow(
      'pdf.js internal',
    );
  });
});
