// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import type { ImageQualityMetrics } from './preprocess';
import {
  assessImageQuality,
  failingPageNumbers,
  isBlankPage,
  mergeQualityReports,
  pickSharpestFrame,
  QUALITY_THRESHOLDS,
  type QualityIssueCode,
  type QualityReport,
} from './quality';

/** Builds an opaque grayscale image from per-pixel luma values. */
function gray(width: number, height: number, lumas: number[]): ImageData {
  const bytes: number[] = [];
  for (const value of lumas) bytes.push(value, value, value, 255);
  return {
    data: new Uint8ClampedArray(bytes),
    width,
    height,
    colorSpace: 'srgb',
  } as unknown as ImageData;
}

/** A 4×4 checkerboard: plenty of edge energy, contrast set by the two values. */
function checkerboard(dark: number, light: number): ImageData {
  const lumas: number[] = [];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) lumas.push((x + y) % 2 === 0 ? dark : light);
  }
  return gray(4, 4, lumas);
}

/** A frame that clears every default threshold. */
function goodImage(): ImageData {
  return checkerboard(60, 200);
}

function codesOf(report: QualityReport): QualityIssueCode[] {
  return report.issues.map((issue) => issue.code);
}

describe('assessImageQuality', () => {
  it('passes a well-exposed, sharp, contrasty frame', () => {
    const report = assessImageQuality(goodImage());
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('carries the raw readings through with the verdict', () => {
    const report = assessImageQuality(goodImage());
    expect(report.metrics.brightness).toBeCloseTo(130);
    expect(report.metrics.contrast).toBeCloseTo(70);
    expect(report.metrics.clipped).toBe(0);
  });

  it('flags an underexposed frame', () => {
    // Mean luma 40, well under the 70 floor, but still sharp enough to pass
    // the sharpness check — so the dark reading is not confounded.
    const report = assessImageQuality(checkerboard(20, 60));
    expect(report.ok).toBe(false);
    expect(codesOf(report)).toContain('too_dark');
  });

  it('does not pile "hold still" on top of a frame that is simply too dark', () => {
    // A flat black frame is dark, flat and edgeless all at once. Darkness is
    // what the user can act on; repeating it as a sharpness complaint would
    // only send them chasing the wrong fix.
    const report = assessImageQuality(gray(4, 4, Array<number>(16).fill(0)));
    expect(codesOf(report)).toEqual(['too_dark', 'low_contrast']);
  });

  it('blames a soft, blown-out frame on glare rather than a shaky hand', () => {
    // 75 % of pixels clipped to white and no edge energy left underneath.
    const report = assessImageQuality(gray(4, 1, [255, 255, 255, 0]));
    expect(codesOf(report)).toEqual(['glare']);
  });

  it('leaves a clean scan alone even when its paper white clips', () => {
    // Document scanners routinely lift the background to pure white, so a
    // perfectly legible scan can measure heavily clipped. Its letter edges are
    // intact, so nothing was lost and nothing is reported — a glare warning on
    // every scanned invoice would be the worse failure by far.
    const report = assessImageQuality(checkerboard(40, 255));
    expect(report.metrics.clipped).toBeGreaterThan(QUALITY_THRESHOLDS.maxClipped - 0.01);
    expect(report.ok).toBe(true);
  });

  it('does not fault a bright frame that kept its detail', () => {
    // Mean luma over the 205 cap, but sharp — nothing for the user to fix.
    const report = assessImageQuality(checkerboard(215, 255));
    expect(report.metrics.brightness).toBeGreaterThan(QUALITY_THRESHOLDS.maxBrightness);
    expect(codesOf(report)).not.toContain('too_bright');
  });

  it.each([
    ['too_dark', { minBrightness: 250 }],
    ['low_contrast', { minContrast: 250 }],
    ['unsharp', { minSharpness: Number.MAX_SAFE_INTEGER }],
    // Overexposure and glare only ever explain a frame that already reads as
    // soft, so isolating them means forcing the sharpness check to trip too.
    ['too_bright', { minSharpness: Number.MAX_SAFE_INTEGER, maxBrightness: 10 }],
    ['glare', { minSharpness: Number.MAX_SAFE_INTEGER, maxClipped: -1 }],
  ] as const)('applies the injected %s threshold in isolation', (code, override) => {
    const report = assessImageQuality(goodImage(), { ...QUALITY_THRESHOLDS, ...override });
    expect(codesOf(report)).toEqual([code]);
  });

  it('gives every issue advice in both registers', () => {
    const report = assessImageQuality(gray(4, 4, Array<number>(16).fill(0)));
    for (const issue of report.issues) {
      expect(issue.hint.length).toBeGreaterThan(0);
      expect(issue.liveHint.length).toBeGreaterThan(0);
      // The overlay line has to be readable at a glance while framing a shot.
      expect(issue.liveHint.length).toBeLessThan(issue.hint.length);
    }
  });
});

describe('mergeQualityReports', () => {
  const metrics: ImageQualityMetrics = {
    sharpness: 0,
    brightness: 0,
    contrast: 0,
    clipped: 0,
  };
  const ok: QualityReport = { ok: true, issues: [], metrics };

  it('passes an empty list — a PDF read from its text layer has no image to fault', () => {
    const merged = mergeQualityReports([]);
    expect(merged.ok).toBe(true);
    expect(merged.issues).toEqual([]);
  });

  it('passes when every page passes', () => {
    expect(mergeQualityReports([ok, ok]).ok).toBe(true);
  });

  it('fails as soon as one page fails, listing each problem once', () => {
    const dark = assessImageQuality(gray(4, 4, Array<number>(16).fill(0)));
    const merged = mergeQualityReports([ok, dark, dark]);
    expect(merged.ok).toBe(false);
    expect(codesOf(merged)).toEqual(['too_dark', 'low_contrast']);
  });

  it('unions problems across pages, in root-cause order', () => {
    const glared = assessImageQuality(gray(4, 1, [255, 255, 255, 0]));
    const dark = assessImageQuality(gray(4, 4, Array<number>(16).fill(0)));
    const soft = assessImageQuality(gray(4, 4, Array<number>(16).fill(128)), {
      ...QUALITY_THRESHOLDS,
      minContrast: 0,
    });
    expect(codesOf(mergeQualityReports([glared, dark, soft]))).toEqual([
      'too_dark',
      'glare',
      'low_contrast',
      'unsharp',
    ]);
  });

  it('carries the first failing page’s readings as the representative sample', () => {
    const dark = assessImageQuality(gray(4, 4, Array<number>(16).fill(0)));
    expect(mergeQualityReports([ok, dark]).metrics).toEqual(dark.metrics);
  });
});

describe('pickSharpestFrame', () => {
  it('returns null for an empty burst', () => {
    expect(pickSharpestFrame([])).toBeNull();
  });

  it('keeps the sharpest frame of a burst', () => {
    const blurred = gray(4, 4, Array<number>(16).fill(128));
    const sharp = checkerboard(0, 255);
    expect(pickSharpestFrame([blurred, sharp])).toBe(sharp);
    expect(pickSharpestFrame([sharp, blurred])).toBe(sharp);
  });

  it('breaks ties towards the earliest frame (deterministic)', () => {
    const first = checkerboard(0, 255);
    const second = checkerboard(0, 255);
    expect(pickSharpestFrame([first, second])).toBe(first);
  });
});

describe('failingPageNumbers', () => {
  const metrics: ImageQualityMetrics = { sharpness: 0, brightness: 0, contrast: 0, clipped: 0 };
  const ok: QualityReport = { ok: true, issues: [], metrics };
  const bad: QualityReport = assessImageQuality(gray(4, 4, Array(16).fill(128)));
  const at = (documentPage: number, report: QualityReport) => ({ documentPage, report });

  it('names the failing pages in page order', () => {
    expect(failingPageNumbers([at(1, ok), at(2, bad), at(3, ok), at(4, bad)])).toEqual([2, 4]);
  });

  // Issue #362: only rasterised pages are judged, so in a PDF that also has
  // text-layer pages the n-th report is not the n-th sheet — numbering by index
  // sent the user off to re-shoot the wrong page.
  it('names the document page, not the position among the judged pages', () => {
    expect(failingPageNumbers([at(2, bad), at(5, bad)])).toEqual([2, 5]);
  });

  it('is empty when every page passes', () => {
    expect(failingPageNumbers([at(1, ok), at(2, ok)])).toEqual([]);
  });

  it('is empty for no pages at all (a text-layer-only PDF)', () => {
    expect(failingPageNumbers([])).toEqual([]);
  });
});

describe('isBlankPage', () => {
  // The readings measured on the sheet from issue #362 — the empty trailing page
  // of an invoice PDF, which the gate used to fault as glare + low contrast.
  const blank: ImageQualityMetrics = {
    sharpness: 9.9,
    brightness: 254.97,
    contrast: 1.56,
    clipped: 0.999,
  };

  it('recognises an empty sheet', () => {
    expect(isBlankPage(blank)).toBe(true);
  });

  it('lets such a page pass the gate instead of advising camera technique', () => {
    // A uniform white frame reproduces the same signature end to end.
    const report = assessImageQuality(gray(4, 4, Array<number>(16).fill(255)));
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('does not swallow a genuinely bad photo', () => {
    // Dark, flat, nothing clipped — all three readings disagree with "blank".
    expect(isBlankPage({ sharpness: 3, brightness: 20, contrast: 4, clipped: 0 })).toBe(false);
    // Faint but inked: contrast alone rules it out.
    expect(isBlankPage({ ...blank, contrast: 12 })).toBe(false);
    // Bright and flat, but hardly anything at white — an overexposed grey shot.
    expect(isBlankPage({ ...blank, clipped: 0.2 })).toBe(false);
    const dark = assessImageQuality(gray(4, 4, Array<number>(16).fill(0)));
    expect(dark.ok).toBe(false);
  });

  it('takes injectable thresholds', () => {
    expect(isBlankPage(blank, { minBrightness: 255, maxContrast: 1, minClipped: 1 })).toBe(false);
  });
});
