// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import {
  buildScanPreview,
  createPagePreview,
  findPreviewLineIndex,
  pageIndexForLine,
  quadBounds,
  scaleQuadToPreview,
  PREVIEW_MAX_SIDE,
  type PageLineRange,
} from './preview';
import type { OcrResult } from './types';

/**
 * A solid-colour frame, so a downscaled copy is trivially predictable. Built
 * structurally because jsdom ships no `ImageData` (a canvas API) — the same
 * convention as `preprocess.test.ts`.
 */
function frame(width: number, height: number, value = 128): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(value);
  return { data, width, height, colorSpace: 'srgb' } as unknown as ImageData;
}

function line(text: string, points: Array<[number, number]>, confidence = 0.9): OcrResult {
  return { text, bbox: { points }, confidence };
}

describe('createPagePreview', () => {
  it('records the source dimensions the OCR coordinates refer to', () => {
    const preview = createPagePreview(frame(2000, 1000));
    expect(preview.sourceWidth).toBe(2000);
    expect(preview.sourceHeight).toBe(1000);
  });

  it('downscales an oversized page to the preview cap', () => {
    const preview = createPagePreview(frame(2048, 1024));
    expect(Math.max(preview.image.width, preview.image.height)).toBe(PREVIEW_MAX_SIDE);
    expect(preview.image.width).toBe(1024);
    expect(preview.image.height).toBe(512);
  });

  it('honours an explicit maxSide', () => {
    const preview = createPagePreview(frame(800, 400), 200);
    expect(preview.image.width).toBe(200);
    expect(preview.image.height).toBe(100);
  });

  // The regression this module exists to prevent: `downscale` returns its input
  // unchanged when the frame already fits, so a preview that did not copy would
  // alias the very ImageData whose buffer the OCR client transfers to the worker.
  it('owns its pixels even when the frame already fits', () => {
    const source = frame(64, 64, 200);
    const preview = createPagePreview(source);
    expect(preview.image).not.toBe(source);
    expect(preview.image.data).not.toBe(source.data);
    expect(preview.image.data[0]).toBe(200);

    // Simulate the zero-copy hand-off detaching the source buffer.
    source.data.fill(0);
    expect(preview.image.data[0]).toBe(200);
  });
});

describe('scaleQuadToPreview', () => {
  it('maps source coordinates into preview pixels on both axes', () => {
    const page = createPagePreview(frame(2000, 1000), 200); // → 200×100, scale 0.1
    const points = scaleQuadToPreview(
      {
        points: [
          [100, 200],
          [900, 200],
          [900, 400],
          [100, 400],
        ],
      },
      page,
    );
    expect(points).toEqual([
      [10, 20],
      [90, 20],
      [90, 40],
      [10, 40],
    ]);
  });

  it('passes an empty quad straight through', () => {
    const page = createPagePreview(frame(100, 100));
    expect(scaleQuadToPreview({ points: [] }, page)).toEqual([]);
  });

  it('yields an empty quad for a degenerate source size rather than Infinity', () => {
    const page = { image: frame(10, 10), sourceWidth: 0, sourceHeight: 0 };
    expect(scaleQuadToPreview({ points: [[1, 1]] }, page)).toEqual([]);
  });
});

describe('quadBounds', () => {
  it('returns the enclosing rectangle', () => {
    expect(
      quadBounds([
        [10, 20],
        [90, 22],
        [88, 40],
        [12, 38],
      ]),
    ).toEqual({
      x: 10,
      y: 20,
      width: 80,
      height: 20,
    });
  });

  it('is zero for an empty quad — the shape PDF text-layer lines carry', () => {
    expect(quadBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('ignores non-finite points instead of poisoning the result', () => {
    expect(
      quadBounds([
        [Number.NaN, 5],
        [10, 10],
        [20, 30],
      ]),
    ).toEqual({
      x: 10,
      y: 10,
      width: 10,
      height: 20,
    });
  });

  it('is zero when every point is non-finite', () => {
    expect(quadBounds([[Number.NaN, Number.NaN]])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe('pageIndexForLine', () => {
  const ranges: PageLineRange[] = [
    { start: 0, end: 2 },
    { start: 5, end: 7 },
  ];

  it('attributes a line to the page whose range contains it', () => {
    expect(pageIndexForLine(0, ranges)).toBe(0);
    expect(pageIndexForLine(1, ranges)).toBe(0);
    expect(pageIndexForLine(5, ranges)).toBe(1);
    expect(pageIndexForLine(6, ranges)).toBe(1);
  });

  // The reason ranges replaced bare start-offsets: lines 2..4 belong to a
  // text-layer page sitting between two rasterised ones and must not be
  // attributed to the preceding image page.
  it('returns -1 for a line in the gap between two previewable pages', () => {
    expect(pageIndexForLine(2, ranges)).toBe(-1);
    expect(pageIndexForLine(3, ranges)).toBe(-1);
    expect(pageIndexForLine(4, ranges)).toBe(-1);
  });

  it('returns -1 past the last range and with no ranges at all', () => {
    expect(pageIndexForLine(7, ranges)).toBe(-1);
    expect(pageIndexForLine(0, [])).toBe(-1);
  });
});

describe('buildScanPreview', () => {
  it('scales each line onto its own page', () => {
    const pages = [
      createPagePreview(frame(1000, 1000), 100),
      createPagePreview(frame(500, 500), 100),
    ];
    const lines = [
      line('Seite 1', [
        [100, 100],
        [200, 100],
        [200, 150],
        [100, 150],
      ]),
      line('Seite 2', [
        [100, 100],
        [200, 100],
        [200, 150],
        [100, 150],
      ]),
    ];
    const preview = buildScanPreview(pages, lines, [
      { start: 0, end: 1 },
      { start: 1, end: 2 },
    ]);

    expect(preview.lines).toHaveLength(2);
    // Page 1 shrank 10×, page 2 only 5× — the same source quad maps differently.
    expect(preview.lines[0]?.points[0]).toEqual([10, 10]);
    expect(preview.lines[1]?.points[0]).toEqual([20, 20]);
    expect(preview.lines[0]?.pageIndex).toBe(0);
    expect(preview.lines[1]?.pageIndex).toBe(1);
  });

  it('drops lines that belong to no preview page and keeps the source index', () => {
    const pages = [createPagePreview(frame(100, 100))];
    const lines = [
      line('text layer', []),
      line('scanned', [
        [10, 10],
        [20, 10],
        [20, 20],
        [10, 20],
      ]),
    ];
    // Only line 1 came from the rasterised page.
    const preview = buildScanPreview(pages, lines, [{ start: 1, end: 2 }]);

    expect(preview.lines).toHaveLength(1);
    expect(preview.lines[0]?.text).toBe('scanned');
    expect(preview.lines[0]?.sourceLineIndex).toBe(1);
  });

  it('carries text and confidence per line', () => {
    const pages = [createPagePreview(frame(100, 100))];
    const lines = [
      line(
        'Ziffer 1',
        [
          [1, 1],
          [2, 1],
          [2, 2],
          [1, 2],
        ],
        0.42,
      ),
    ];
    const preview = buildScanPreview(pages, lines, [{ start: 0, end: 1 }]);
    expect(preview.lines[0]).toMatchObject({ text: 'Ziffer 1', confidence: 0.42 });
  });

  it('yields no lines when there are no previewable pages', () => {
    const preview = buildScanPreview([], [line('a', [])], []);
    expect(preview.pages).toEqual([]);
    expect(preview.lines).toEqual([]);
  });
});

describe('findPreviewLineIndex', () => {
  it('maps a scan line index onto the preview line list', () => {
    const pages = [createPagePreview(frame(100, 100))];
    const lines = [line('skipped', []), line('a', [[1, 1]]), line('b', [[2, 2]])];
    const preview = buildScanPreview(pages, lines, [{ start: 1, end: 3 }]);

    // Line 0 has no preview, so the preview list is offset by one.
    expect(findPreviewLineIndex(preview, 1)).toBe(0);
    expect(findPreviewLineIndex(preview, 2)).toBe(1);
    expect(findPreviewLineIndex(preview, 0)).toBe(-1);
  });
});
