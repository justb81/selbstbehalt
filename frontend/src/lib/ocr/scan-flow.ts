// SPDX-License-Identifier: Apache-2.0
/**
 * Scan-flow orchestration (docs/design.md §4.1, issue #26) — the pure glue that
 * turns recognised OCR lines into a reviewable, savable invoice:
 *
 *   OCR lines  →  joined text  →  GOÄ/GOZ/GOT parser (#16)  →  ScanResult
 *   ScanResult (+ user edits)  →  InvoiceCreatePayload  →  POST /api/invoices
 *
 * Everything here is framework-agnostic and deterministic so the whole pipeline
 * is unit-testable without a worker, a camera or a DOM. The components
 * (`OCRScanner`, `InvoiceReview`) and the `/invoices/scan` route compose these.
 *
 * **Privacy by design:** only recognised text and structured metadata travel
 * through these helpers — never the image. The {@link InvoiceCreatePayload} this
 * builds carries no image; `ocr_raw` is included only when the user opts in
 * (docs/design.md §8.1/§8.2).
 */
import type { ProviderType } from '@selbstbehalt/shared';
import { type InvoiceCreatePayload, invoiceCreatePayloadSchema } from '@selbstbehalt/shared';

import {
  parseInvoice,
  type ParsedInvoice,
  type ParsedPosition,
  type ValidationContext,
} from '$lib/utils/goae-parser';
import { resolveFeeTable } from '$lib/data/fee-tables';
import type { FeeScheduleId } from '$lib/data/fee-schedule';

import type { OcrResult } from './types';

/** Default OCR confidence below which a line/field is flagged as uncertain. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.8;

/** Round to whole cents, matching the `money` schema's two-decimal rule. */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * The result of scanning one image: the parsed invoice plus the provenance the
 * review screen needs — which schedule it was parsed against, the raw OCR text
 * (kept only in memory for review/opt-in save), and per-line/per-position OCR
 * confidence so the UI can flag uncertain reads.
 */
export interface ScanResult {
  /** Fee schedule the positions were parsed and validated against. */
  schedule: FeeScheduleId;
  /** The recognised text, newline-joined (for review + optional `ocr_raw`). */
  ocrText: string;
  /** The fully parsed + validated invoice. */
  parsed: ParsedInvoice;
  /** Mean OCR confidence across all recognised lines, in `[0, 1]`. */
  meanConfidence: number;
  /**
   * OCR confidence for each parsed position, aligned to
   * {@link ParsedInvoice.positions} by index. Falls back to `1` when a
   * position's source line can't be matched back to an OCR line.
   */
  positionConfidence: number[];
}

/** An insured person the scanned invoice can be filed under (review dropdown). */
export interface InsuredOption {
  id: string;
  label: string;
}

/** Joins recognised OCR lines into a single text block for the parser. */
export function ocrResultsToText(results: OcrResult[]): string {
  return results.map((r) => r.text).join('\n');
}

/** Mean confidence across recognised lines; `1` when there are none. */
export function meanConfidence(results: OcrResult[]): number {
  if (results.length === 0) return 1;
  const sum = results.reduce((acc, r) => acc + r.confidence, 0);
  return sum / results.length;
}

/**
 * Maps each parsed position back to the confidence of the OCR line it came
 * from, matching on the trimmed raw line text. Unmatched positions default to
 * `1` (treated as confident) rather than flagged.
 */
function positionConfidences(positions: ParsedPosition[], results: OcrResult[]): number[] {
  const byText = new Map<string, number>();
  for (const r of results) {
    const key = r.text.trim();
    // Keep the lowest confidence when several lines share text.
    byText.set(key, Math.min(r.confidence, byText.get(key) ?? r.confidence));
  }
  return positions.map((p) => (p.raw ? (byText.get(p.raw.trim()) ?? 1) : 1));
}

/**
 * Parses recognised OCR lines into a {@link ScanResult} against the chosen fee
 * schedule. Pure: no I/O, no worker — feed it the OCR output and a schedule id.
 */
export function buildScanResult(
  results: OcrResult[],
  schedule: FeeScheduleId,
  context: ValidationContext = {},
): ScanResult {
  const ocrText = ocrResultsToText(results);
  const parsed = parseInvoice(ocrText, resolveFeeTable(schedule), context);
  return {
    schedule,
    ocrText,
    parsed,
    meanConfidence: meanConfidence(results),
    positionConfidence: positionConfidences(parsed.positions, results),
  };
}

/** Schedule → default provider type for a freshly scanned invoice. */
export function defaultProviderType(schedule: FeeScheduleId): ProviderType {
  switch (schedule) {
    case 'GOZ':
      return 'zahnarzt';
    case 'GOT':
      return 'sonstiges';
    default:
      return 'arzt';
  }
}

/** A single editable invoice line in the review screen. */
export interface ReviewPosition {
  /** Billing number (Ziffer). */
  goaeNumber: string;
  description: string | null;
  multiplier: number;
  baseAmount: number;
  chargedAmount: number;
  /** False when the position carries a §5 / lookup flag. */
  isValid: boolean;
  /** Combined flag reasons, or null when the line is clean. */
  flagReason: string | null;
}

/** The full, user-confirmed review state the save step serialises. */
export interface ReviewState {
  insuredPersonId: string;
  invoiceDate: string;
  invoiceNumber: string | null;
  providerName: string;
  providerType: ProviderType;
  schedule: FeeScheduleId;
  positions: ReviewPosition[];
  /** Raw OCR text to persist for later auditing — only when the user opts in. */
  ocrRaw?: string | null;
}

/** Builds the initial editable positions from a parsed invoice. */
export function toReviewPositions(parsed: ParsedInvoice): ReviewPosition[] {
  return parsed.positions.map((p) => ({
    goaeNumber: p.ziffer,
    description: p.description ?? null,
    multiplier: p.multiplier,
    baseAmount: p.baseAmount ?? 0,
    chargedAmount: p.chargedAmount,
    isValid: p.isValid,
    flagReason: p.flags.length > 0 ? p.flags.map((f) => f.reason).join(' ') : null,
  }));
}

/**
 * Serialises a confirmed {@link ReviewState} into the `POST /api/invoices` body
 * (§7.1). The total is recomputed from the (possibly edited) lines so it always
 * matches what is saved. Validates against the shared schema so a malformed
 * payload fails here, before the request, with a Zod error.
 */
export function toInvoicePayload(state: ReviewState): InvoiceCreatePayload {
  const positions = state.positions.map((p) => ({
    goae_number: p.goaeNumber,
    goae_category: state.schedule,
    description: p.description,
    multiplier: p.multiplier,
    base_amount: round2(p.baseAmount),
    charged_amount: round2(p.chargedAmount),
    is_valid: p.isValid,
    flag_reason: p.flagReason,
  }));
  const totalAmount = round2(positions.reduce((sum, p) => sum + p.charged_amount, 0));

  return invoiceCreatePayloadSchema.parse({
    insured_person_id: state.insuredPersonId,
    invoice_date: state.invoiceDate,
    invoice_number: state.invoiceNumber,
    provider_name: state.providerName,
    provider_type: state.providerType,
    total_amount: totalAmount,
    status: 'neu',
    ocr_raw: state.ocrRaw ?? null,
    positions,
  });
}
