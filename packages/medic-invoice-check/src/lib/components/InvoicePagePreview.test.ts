// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import InvoicePagePreview from './InvoicePagePreview.svelte';
import { buildScanPreview, createPagePreview } from '../ocr/preview';
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

/** One page carrying two recognised lines. */
function singlePage() {
  return buildScanPreview(
    [createPagePreview(frame(100, 200))],
    [line('250 Blutentnahme', 20), line('75 Bericht', 60)],
    [{ start: 0, end: 2 }],
  );
}

/** Two pages, one recognised line each. */
function twoPages() {
  return buildScanPreview(
    [createPagePreview(frame(100, 200)), createPagePreview(frame(100, 200))],
    [line('Seite eins', 20), line('Seite zwei', 20)],
    [
      { start: 0, end: 1 },
      { start: 1, end: 2 },
    ],
  );
}

describe('InvoicePagePreview', () => {
  it('renders nothing when there are no pages', () => {
    const { container } = render(InvoicePagePreview, {
      props: { preview: { pages: [], lines: [] } },
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

  it('offers no pager for a single page', () => {
    render(InvoicePagePreview, { props: { preview: singlePage() } });
    expect(screen.queryByText('Nächste Seite')).not.toBeInTheDocument();
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
});
