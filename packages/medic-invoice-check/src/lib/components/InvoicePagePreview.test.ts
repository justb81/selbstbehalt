// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import InvoicePagePreview from './InvoicePagePreview.svelte';
import { buildScanPreview, createPagePreview, createTextPagePreview } from '../ocr/preview';
import type { OcrResult } from '../ocr/types';

/** Structural ImageData — jsdom ships none (a canvas API). */
function frame(width: number, height: number): ImageData {
  return {
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
    colorSpace: 'srgb',
  } as unknown as ImageData;
}

/** A PDF text-layer line: exact text, no geometry at all. */
function textLine(text: string): OcrResult {
  return { text, bbox: { points: [] }, confidence: 1 };
}

function line(text: string, y: number): OcrResult {
  return {
    text,
    bbox: {
      points: [
        [10, y],
        [90, y],
        [90, y + 10],
        [10, y + 10],
      ],
    },
    confidence: 0.9,
  };
}

/** One image page carrying two recognised lines. */
function singlePage() {
  return buildScanPreview(
    [createPagePreview(frame(100, 200), { documentPage: 1 })],
    [line('250 Blutentnahme', 20), line('75 Bericht', 60)],
    [{ start: 0, end: 2 }],
    1,
  );
}

/** Two image pages, one recognised line each. */
function twoPages() {
  return buildScanPreview(
    [
      createPagePreview(frame(100, 200), { documentPage: 1 }),
      createPagePreview(frame(100, 200), { documentPage: 2 }),
    ],
    [line('Seite eins', 20), line('Seite zwei', 20)],
    [
      { start: 0, end: 1 },
      { start: 1, end: 2 },
    ],
    2,
  );
}

/** A PDF read entirely from its text layer: lines, no pixels (issue #362). */
function textLayerPage() {
  return buildScanPreview(
    [createTextPagePreview(1)],
    [textLine('Rechnungsdatum: 07.05.2026'), textLine('1 Beratung 2,3 10,72')],
    [{ start: 0, end: 2 }],
    1,
  );
}

/**
 * A mixed PDF: page 1 read from its text layer, page 2 rasterised. The case from
 * issue #362 — the pager used to call the second sheet "Seite 1 von 1".
 */
function mixedPages() {
  return buildScanPreview(
    [createTextPagePreview(1), createPagePreview(frame(100, 200), { documentPage: 2 })],
    [textLine('aus dem Textlayer'), line('gescannte Zeile', 20)],
    [
      { start: 0, end: 1 },
      { start: 1, end: 2 },
    ],
    2,
  );
}

describe('InvoicePagePreview', () => {
  it('renders nothing when there are no pages', () => {
    const { container } = render(InvoicePagePreview, {
      props: { preview: { pages: [], lines: [], documentPageCount: 0 } },
    });
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('names the preview so it is not an unlabelled graphic', () => {
    render(InvoicePagePreview, { props: { preview: singlePage() } });
    const image = screen.getByRole('img');
    expect(image).toHaveAttribute('aria-label', expect.stringContaining('Seite 1 von 1'));
    expect(image.getAttribute('aria-label')).toContain('2 erkannten Textzeilen');
  });

  // A canvas conveys nothing to a screen reader, so the recognised text has to
  // exist as real content too.
  it('exposes the recognised lines as text, not only as pixels', () => {
    render(InvoicePagePreview, { props: { preview: singlePage() } });
    expect(screen.getByText('250 Blutentnahme')).toBeInTheDocument();
    expect(screen.getByText('75 Bericht')).toBeInTheDocument();
  });

  it('reports the selected line when one is picked from the list', async () => {
    const onLineSelect = vi.fn();
    render(InvoicePagePreview, { props: { preview: singlePage(), onLineSelect } });
    await userEvent.click(screen.getByText('75 Bericht'));
    // Second line of the page → scan-line index 1.
    expect(onLineSelect).toHaveBeenCalledWith(1);
  });

  it('marks the active line as current', () => {
    render(InvoicePagePreview, { props: { preview: singlePage(), activeLineIndex: 1 } });
    const active = screen.getByText('75 Bericht').closest('button');
    expect(active).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('250 Blutentnahme').closest('button')).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('offers no pager for a single-page document', () => {
    render(InvoicePagePreview, { props: { preview: singlePage() } });
    expect(screen.queryByText('Nächste Seite')).not.toBeInTheDocument();
    expect(screen.queryByText(/Seite 1 von 1/)).not.toBeInTheDocument();
  });

  it('pages through a multi-page document', async () => {
    render(InvoicePagePreview, { props: { preview: twoPages() } });
    expect(screen.getByText(/Seite 1 von 2/)).toBeInTheDocument();
    expect(screen.getByText('Seite eins')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Nächste Seite'));
    expect(screen.getByText(/Seite 2 von 2/)).toBeInTheDocument();
    // Only the lines of the visible page are listed.
    expect(screen.getByText('Seite zwei')).toBeInTheDocument();
    expect(screen.queryByText('Seite eins')).not.toBeInTheDocument();
  });

  // Selecting a position row whose line lives on another page must follow it
  // there, or the highlight would land on a page nobody is looking at.
  it('follows the active line onto its own page', async () => {
    const { rerender } = render(InvoicePagePreview, {
      props: { preview: twoPages(), activeLineIndex: null },
    });
    expect(screen.getByText(/Seite 1 von 2/)).toBeInTheDocument();

    await rerender({ preview: twoPages(), activeLineIndex: 1 });
    expect(screen.getByText(/Seite 2 von 2/)).toBeInTheDocument();
  });

  // Issue #362: a text-layer page has no pixels by design, and the review screen
  // used to render the empty shell of a page image plus "(0)" recognised lines.
  describe('a page read from a PDF text layer', () => {
    it('explains the missing page image instead of showing an empty canvas', () => {
      const { container } = render(InvoicePagePreview, { props: { preview: textLayerPage() } });
      expect(container.querySelector('canvas')).toBeNull();
      expect(screen.getByText('Kein Seitenbild nötig')).toBeInTheDocument();
      expect(screen.getByText(/direkt aus dem PDF gelesen/)).toBeInTheDocument();
    });

    it('lists the lines it read, counted as read rather than recognised', () => {
      render(InvoicePagePreview, { props: { preview: textLayerPage() } });
      expect(screen.getByText('Gelesene Textzeilen dieser Seite (2)')).toBeInTheDocument();
      expect(screen.getByText('Rechnungsdatum: 07.05.2026')).toBeInTheDocument();
      expect(screen.getByText('1 Beratung 2,3 10,72')).toBeInTheDocument();
    });

    it('still highlights the line behind the position being reviewed', async () => {
      const { rerender } = render(InvoicePagePreview, {
        props: { preview: textLayerPage(), activeLineIndex: null },
      });
      await rerender({ preview: textLayerPage(), activeLineIndex: 1 });
      expect(screen.getByText('1 Beratung 2,3 10,72').closest('button')).toHaveAttribute(
        'aria-current',
        'true',
      );
    });
  });

  describe('a mixed document', () => {
    // The exact lie from issue #362: sheet 2 of 2 announced as "Seite 1 von 1",
    // because the pager counted preview entries rather than document pages.
    it('names the document page, not the index in the preview list', async () => {
      render(InvoicePagePreview, { props: { preview: mixedPages() } });
      expect(screen.getByText(/Seite 1 von 2/)).toBeInTheDocument();

      await userEvent.click(screen.getByText('Nächste Seite'));
      expect(screen.getByText(/Seite 2 von 2/)).toBeInTheDocument();
      expect(screen.getByText('gescannte Zeile')).toBeInTheDocument();
    });

    it('shows the canvas only on the rasterised page', async () => {
      const { container } = render(InvoicePagePreview, { props: { preview: mixedPages() } });
      expect(container.querySelector('canvas')).toBeNull();

      await userEvent.click(screen.getByText('Nächste Seite'));
      expect(container.querySelector('canvas')).not.toBeNull();
      expect(screen.queryByText('Kein Seitenbild nötig')).not.toBeInTheDocument();
    });
  });

  describe('showRecognizedLines={false}', () => {
    // The pre-OCR quality warning: nothing has been recognised *yet*, so a count
    // of zero would read as a failed scan (issue #362).
    it('drops the line list and the count from the label', () => {
      render(InvoicePagePreview, {
        props: { preview: singlePage(), showRecognizedLines: false },
      });
      expect(screen.queryByText(/Textzeilen dieser Seite/)).not.toBeInTheDocument();
      expect(screen.getByRole('img').getAttribute('aria-label')).not.toContain('Textzeilen');
    });
  });

  it('says how many pages it kept a preview for when the tail was truncated', () => {
    const preview = buildScanPreview(
      [
        createPagePreview(frame(100, 200), { documentPage: 1 }),
        createPagePreview(frame(100, 200), { documentPage: 2 }),
      ],
      [line('Seite eins', 20), line('Seite zwei', 20)],
      [
        { start: 0, end: 1 },
        { start: 1, end: 2 },
      ],
      5,
    );
    render(InvoicePagePreview, { props: { preview } });
    expect(screen.getByText(/Vorschau für 2 von 5 Seiten gespeichert/)).toBeInTheDocument();
    expect(screen.getByText(/Seite 1 von 5/)).toBeInTheDocument();
  });
});
