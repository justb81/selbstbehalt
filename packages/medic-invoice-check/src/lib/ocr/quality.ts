// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
/**
 * Capture-quality policy (docs/architecture.md §6.1, §11, issues #279/#281).
 *
 * Turns the raw readings from `./preprocess`' {@link measureImageQuality} into a
 * verdict a human can act on: is this frame worth running OCR over, and if not,
 * what should the user change? A blurred, dark or glare-struck original is the
 * single biggest cause of a poor recognition result, and today the user only
 * finds out *after* the most expensive step of the pipeline has run.
 *
 * Two consumers, one table of issues:
 *
 * - the pre-OCR gate in `OCRScanner` (#279) shows {@link QualityIssue.hint} —
 *   a full sentence, room to explain — for every problem it found;
 * - the live camera overlay (#281) shows {@link QualityIssue.liveHint} of the
 *   first one, terse enough to read at a glance while framing the shot.
 *
 * The verdict is **advisory, never blocking**: the user can always recognise a
 * frame the metrics dislike. See `OCRScanner`'s "Trotzdem erkennen" action.
 *
 * Everything here is pure and deterministic — no canvas, DOM, network or clock
 * — so the whole policy is unit-testable and no pixel leaves the device
 * (docs/architecture.md §2.2, §8.1).
 */
import { measureImageQuality, type ImageQualityMetrics } from './preprocess';

/** Stable identifiers for the capture problems the metrics can detect. */
export type QualityIssueCode = 'too_dark' | 'glare' | 'too_bright' | 'low_contrast' | 'unsharp';

/** One detected capture problem, with advice in both registers. */
export interface QualityIssue {
  code: QualityIssueCode;
  /** Full-sentence advice for the pre-OCR warning (de-DE). */
  hint: string;
  /** Terse advice for the live camera overlay (de-DE). */
  liveHint: string;
}

/** The verdict on one frame. */
export interface QualityReport {
  /** True when no threshold was breached — the frame is worth recognising. */
  ok: boolean;
  /**
   * Every problem found, in root-cause order (see {@link ISSUE_ORDER}). Empty
   * when {@link ok}.
   */
  issues: QualityIssue[];
  /** The raw readings the verdict was derived from. */
  metrics: ImageQualityMetrics;
}

/** Thresholds a frame must clear to pass. */
export interface QualityThresholds {
  /** Minimum Laplacian variance; below this the frame reads as blurred. */
  minSharpness: number;
  /** Minimum mean luma; below this the frame reads as underexposed. */
  minBrightness: number;
  /** Maximum mean luma; above this the frame reads as overexposed. */
  maxBrightness: number;
  /** Minimum luma standard deviation; below this the frame reads as washed out. */
  minContrast: number;
  /** Maximum share of clipped pixels before glare is reported. */
  maxClipped: number;
}

/**
 * Default thresholds, measured on the `QUALITY_METRIC_MAX_SIDE` (256 px) copy.
 *
 * These are first-pass values chosen from the physics of each metric rather
 * than fitted to a reference corpus of real invoice photos — treat them as a
 * starting point and retune them against real captures. They are exported and
 * injectable ({@link assessImageQuality} takes them as a parameter) precisely so
 * that retuning is a data change, not code surgery.
 */
export const QUALITY_THRESHOLDS: QualityThresholds = {
  minSharpness: 20,
  minBrightness: 70,
  maxBrightness: 205,
  minContrast: 28,
  maxClipped: 0.5,
};

/** Readings above/below which a page counts as carrying no ink at all. */
export interface BlankPageThresholds {
  /** Minimum mean luma — a blank sheet is essentially paper-white throughout. */
  minBrightness: number;
  /** Maximum luma standard deviation; a blank sheet has virtually none. */
  maxContrast: number;
  /** Minimum share of clipped pixels — almost the whole page is at white. */
  minClipped: number;
}

/**
 * Default blank-page thresholds, measured on the reported case (issue #362): the
 * trailing sheet of an invoice PDF read at `brightness 254.97`, `contrast 1.56`,
 * `clipped 0.999`. A page with even a letterhead and a line of text sits far from
 * all three at once, so the window is deliberately narrow — this must never
 * swallow a real, faintly-scanned invoice page.
 */
export const BLANK_PAGE_THRESHOLDS: BlankPageThresholds = {
  minBrightness: 250,
  maxContrast: 5,
  minClipped: 0.95,
};

/**
 * True when the frame carries essentially no ink — a cover sheet, a stamp page,
 * an empty trailing sheet of a PDF.
 *
 * Such a page breaches `minContrast` and (being clipped-white throughout)
 * `maxClipped`, so the gate used to fault it and advise the user to change the
 * camera angle and lay the invoice on a dark surface — advice that is impossible
 * to act on for a digitally generated PDF page and pointless for a blank sheet
 * either way (issue #362). There is nothing on it to recognise and nothing about
 * it to improve, so it is not a capture problem.
 *
 * All three readings must agree: a genuinely bad photo is dark, or noisy, or
 * unevenly lit, and fails at least one of them.
 */
export function isBlankPage(
  metrics: ImageQualityMetrics,
  thresholds: BlankPageThresholds = BLANK_PAGE_THRESHOLDS,
): boolean {
  return (
    metrics.brightness >= thresholds.minBrightness &&
    metrics.contrast <= thresholds.maxContrast &&
    metrics.clipped >= thresholds.minClipped
  );
}

/** Advice for each problem, in both registers. */
const ISSUE_TEXTS: Record<QualityIssueCode, Omit<QualityIssue, 'code'>> = {
  too_dark: {
    hint: 'Die Aufnahme ist zu dunkel. Sorgen Sie für mehr Licht und vermeiden Sie Ihren eigenen Schatten auf der Rechnung.',
    liveHint: 'Zu dunkel – mehr Licht',
  },
  glare: {
    hint: 'Reflexionen überstrahlen Teile der Rechnung. Ändern Sie den Aufnahmewinkel oder das Licht.',
    liveHint: 'Reflexion vermeiden – Winkel ändern',
  },
  too_bright: {
    hint: 'Die Aufnahme ist überbelichtet. Reduzieren Sie das direkte Licht auf die Rechnung.',
    liveHint: 'Zu hell – Licht reduzieren',
  },
  low_contrast: {
    hint: 'Die Aufnahme ist zu kontrastarm. Legen Sie die Rechnung flach auf einen dunklen Untergrund.',
    liveHint: 'Zu kontrastarm – dunkler Untergrund',
  },
  unsharp: {
    hint: 'Die Aufnahme wirkt unscharf. Halten Sie das Gerät ruhig und gehen Sie näher an die Rechnung heran.',
    liveHint: 'Ruhig halten – näher ran',
  },
};

/** Shown in the live overlay while the frame passes every threshold. */
export const QUALITY_OK_HINT = 'Passt – jetzt auslösen';

/**
 * Root-cause order. The overlay has room for one line, so the most explanatory
 * problem has to come first: told "hold still" when the real fix is "turn on a
 * light", a user will keep taking the same unusable photo.
 */
const ISSUE_ORDER: QualityIssueCode[] = [
  'too_dark',
  'glare',
  'too_bright',
  'low_contrast',
  'unsharp',
];

function issue(code: QualityIssueCode): QualityIssue {
  return { code, ...ISSUE_TEXTS[code] };
}

/**
 * Which problems the given readings amount to, in {@link ISSUE_ORDER}.
 *
 * Two rules are absolute, because they ruin a capture on their own: an
 * underexposed frame is mostly sensor noise, and a washed-out one has nothing
 * for the recogniser to segment.
 *
 * Brightness and clipping at the *top* end are different, and the naive reading
 * of them is wrong in a way that matters here. A clean scanned PDF is mostly
 * paper: scanners routinely lift the background to pure white, so a perfectly
 * legible scan can measure 90 % clipped with a mean luma well above 200.
 * Thresholding those numbers directly would fire a glare warning on every
 * scanned invoice — the worst outcome for an advisory check, since a warning
 * users learn to dismiss is a warning that no longer works.
 *
 * What actually distinguishes glare from bright paper is whether detail
 * survived: blown-out highlights erase the text under them, while a bright scan
 * keeps its crisp letter edges. So clipping and overexposure are not reported
 * as faults in their own right — they are used to *explain* a frame that has
 * already measured as soft. Same detection as a plain sharpness check, better
 * attribution: "avoid the reflection" instead of "hold still".
 */
function issuesFor(metrics: ImageQualityMetrics, thresholds: QualityThresholds): QualityIssue[] {
  const tooDark = metrics.brightness < thresholds.minBrightness;
  const soft = metrics.sharpness < thresholds.minSharpness;

  const breached: Record<QualityIssueCode, boolean> = {
    too_dark: tooDark,
    low_contrast: metrics.contrast < thresholds.minContrast,
    // Softness is reported once, under whichever cause best explains it.
    glare: soft && metrics.clipped > thresholds.maxClipped,
    too_bright:
      soft &&
      metrics.clipped <= thresholds.maxClipped &&
      metrics.brightness > thresholds.maxBrightness,
    // Nothing left to blame it on — unless the frame is already too dark, in
    // which case that is the advice to act on and this would just be noise.
    unsharp:
      soft &&
      !tooDark &&
      metrics.clipped <= thresholds.maxClipped &&
      metrics.brightness <= thresholds.maxBrightness,
  };
  return ISSUE_ORDER.filter((code) => breached[code]).map(issue);
}

/**
 * Judges one frame. Measures it (downscaling internally — pass an already-small
 * frame and {@link measureImageQuality} skips the resample) and reports every
 * threshold it breaches.
 *
 * A blank page ({@link isBlankPage}) passes: it breaches thresholds no advice can
 * fix, and faulting it produced camera hints for empty PDF sheets (issue #362).
 */
export function assessImageQuality(
  image: ImageData,
  thresholds: QualityThresholds = QUALITY_THRESHOLDS,
): QualityReport {
  const metrics = measureImageQuality(image);
  if (isBlankPage(metrics)) return { ok: true, issues: [], metrics };
  const issues = issuesFor(metrics, thresholds);
  return { ok: issues.length === 0, issues, metrics };
}

/**
 * Merges the verdicts of several frames — e.g. every rasterised page of one
 * PDF — into a single report: `ok` only when every frame passed, each distinct
 * problem listed once, in {@link ISSUE_ORDER}. The metrics of the *first*
 * failing frame are carried through as the representative reading; with no
 * failures, those of the first frame.
 *
 * Returns a passing report for an empty list: a document with nothing to
 * rasterise (a PDF read entirely from its text layer, #278) has no image
 * quality to complain about.
 */
export function mergeQualityReports(reports: QualityReport[]): QualityReport {
  const failing = reports.filter((r) => !r.ok);
  const seen = new Set<QualityIssueCode>();
  for (const report of failing) {
    for (const found of report.issues) seen.add(found.code);
  }
  const metrics = (failing[0] ?? reports[0])?.metrics ?? {
    sharpness: 0,
    brightness: 0,
    contrast: 0,
    clipped: 0,
  };
  return {
    ok: failing.length === 0,
    issues: ISSUE_ORDER.filter((code) => seen.has(code)).map(issue),
    metrics,
  };
}

/**
 * One page's verdict, tagged with where that page sat in the document.
 *
 * The tag is not redundant with the array index: only rasterised pages are
 * judged, so in a PDF mixing text-layer and scanned pages the n-th report is not
 * the n-th sheet — naming it by index told the user to re-shoot the wrong page
 * (issue #362).
 */
export interface PageQualityReport {
  /** 1-based page number in the scanned document. */
  documentPage: number;
  report: QualityReport;
}

/**
 * Document page numbers of the reports that failed, in page order.
 *
 * {@link mergeQualityReports} deliberately collapses the per-page verdicts into
 * one, which loses *which* sheet was bad — unhelpful advice for a multi-page
 * document, where "unscharf" leaves the user re-shooting all of them. Callers
 * keep the individual reports and use this to name the offending pages.
 */
export function failingPageNumbers(reports: readonly PageQualityReport[]): number[] {
  return reports.filter((entry) => !entry.report.ok).map((entry) => entry.documentPage);
}

/**
 * Picks the sharpest of a burst of frames (issue #281). Used by the camera
 * shutter's fallback path to shrug off hand shake: `ImageCapture.takePhoto()`
 * already returns a stabilised still at full sensor resolution and is always
 * preferred (#280), but where it is unavailable the only frames on offer are
 * video frames — so grab several and keep the best one.
 *
 * Deterministic: ties go to the earliest frame. Returns `null` for an empty
 * list so the caller can fall back rather than guess.
 */
export function pickSharpestFrame(frames: ImageData[]): ImageData | null {
  let best: ImageData | null = null;
  let bestSharpness = -Infinity;
  for (const frame of frames) {
    const { sharpness } = measureImageQuality(frame);
    if (sharpness > bestSharpness) {
      bestSharpness = sharpness;
      best = frame;
    }
  }
  return best;
}
