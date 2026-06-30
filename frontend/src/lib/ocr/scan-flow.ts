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
 * builds carries no image; `ocr_raw` is saved by default on every scanned
 * invoice and can be opted out via the UI (docs/design.md §8.1/§8.2).
 */
import {
  invoiceCreatePayloadSchema,
  roundCents,
  type InvoiceCreatePayload,
  type PositionCategory,
  type ProviderType,
} from '@selbstbehalt/shared';

import { parseInvoice, parsePositionLine, type ValidationContext } from '$lib/utils/goae-parser';
import type { ParsedInvoice } from '$lib/utils/goae-parser';
import type { FeeScheduleId, FeeScheduleTable } from '$lib/data/fee-schedule';

import type { OcrResult } from './types';

/** Default OCR confidence below which a line/field is flagged as uncertain. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.8;

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
   * {@link ParsedInvoice.positions} by index — both are derived from the same
   * recognised lines in the same order, so the k-th position-line's confidence
   * lines up with the k-th parsed position (no stringly-typed re-matching).
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
 * Confidence of each recognised line the parser reads as a position, in order.
 * `parseInvoice` extracts positions from the same lines in the same order
 * ({@link parsePositionLine} per line), so this array aligns 1:1 with
 * {@link ParsedInvoice.positions} by index — robust to duplicate line text and
 * whitespace differences, unlike a text-keyed lookup.
 */
function positionConfidences(results: OcrResult[]): number[] {
  return results.filter((r) => parsePositionLine(r.text)).map((r) => r.confidence);
}

/**
 * Parses recognised OCR lines into a {@link ScanResult}. Pass an array of
 * tables to support mixed invoices (e.g. `[gozTable, goaeTable]`); the first
 * element is the primary/default schedule. A single table is also accepted.
 */
export function buildScanResult(
  results: OcrResult[],
  schedule: FeeScheduleId,
  tables: FeeScheduleTable | FeeScheduleTable[],
  context: ValidationContext = {},
): ScanResult {
  const ocrText = ocrResultsToText(results);
  const parsed = parseInvoice(ocrText, tables, context);
  return {
    schedule,
    ocrText,
    parsed,
    meanConfidence: meanConfidence(results),
    positionConfidence: positionConfidences(results),
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
  /** Fee schedule this position is billed under (GOÄ / GOZ / GOT). */
  goaeCategory: FeeScheduleId;
  /**
   * Funktionale Art der Position — `auslagenersatz` (§10 GOÄ, z. B. Porto-/
   * Versandkosten, stets voll erstattet) or `leistung`. Detected from the
   * description; overridable by the user in the review UI.
   */
  positionCategory: PositionCategory;
  /** Anzahl (quantity). */
  quantity: number;
  /**
   * Leistungsdatum (ISO YYYY-MM-DD) extracted from a per-line date prefix on
   * Sammelrechnungen. `null` when not stated. Used for BRE year assignment and
   * session-scoped constraint checking.
   */
  treatmentDate: string | null;
  description: string | null;
  multiplier: number;
  baseAmount: number;
  chargedAmount: number;
  /** False when the position carries a §5 / lookup flag. */
  isValid: boolean;
  /** Combined flag reasons, or null when the line is clean. */
  flagReason: string | null;
  /**
   * OCR confidence of this line, carried on the row so per-row uncertainty
   * markers stay correct after rows are reordered or removed (not indexed back
   * into the scan).
   */
  confidence: number;
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
  /** Raw OCR text to persist for later re-parsing and auditing (saved by default). */
  ocrRaw?: string | null;
}

/**
 * Builds the initial editable positions from a scan, carrying per-row confidence.
 * Propagates treatment dates forward: a position without its own date inherits
 * the date from the nearest preceding position that carries one (Sammelrechnung
 * convention — the date printed once at the top of a block applies to all lines
 * below until a new date appears).
 */
export function toReviewPositions(scan: ScanResult): ReviewPosition[] {
  let lastDate: string | null = null;
  return scan.parsed.positions.map((p, i) => {
    if (p.treatmentDate !== null) lastDate = p.treatmentDate;
    return {
      goaeNumber: p.ziffer,
      goaeCategory: p.feeSchedule,
      positionCategory: p.positionCategory,
      quantity: p.quantity,
      treatmentDate: p.treatmentDate ?? lastDate,
      description: p.description ?? null,
      multiplier: p.multiplier,
      baseAmount: p.baseAmount ?? 0,
      chargedAmount: p.chargedAmount,
      isValid: p.isValid,
      flagReason: p.flags.length > 0 ? p.flags.map((f) => f.reason).join(' ') : null,
      confidence: scan.positionConfidence[i] ?? 1,
    };
  });
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
    goae_category: p.goaeCategory,
    position_category: p.positionCategory,
    quantity: p.quantity,
    treatment_date: p.treatmentDate ?? state.invoiceDate,
    description: p.description,
    multiplier: p.multiplier,
    base_amount: roundCents(p.baseAmount),
    charged_amount: roundCents(p.chargedAmount),
    is_valid: p.isValid,
    flag_reason: p.flagReason,
  }));
  const totalAmount = roundCents(positions.reduce((sum, p) => sum + p.charged_amount, 0));

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
