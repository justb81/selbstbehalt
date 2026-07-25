// SPDX-License-Identifier: Apache-2.0
import { ZodError } from 'zod';
import { describe, expect, it } from 'vitest';

import {
  buildScanResult,
  meanConfidence,
  ocrResultsToText,
  positionLineIndices,
  scheduleForProviderType,
  toInvoicePayload,
  toReviewPositions,
  type ReviewState,
} from './scan-flow';
import { textToOcrResults } from './scan-ocr';
import type { OcrResult } from './types';
import goaeJson from '../data/goae.json';
import gozJson from '../data/goz.json';
import type { FeeScheduleTable } from '../data/fee-schedule';

const GOAE = goaeJson as unknown as FeeScheduleTable;
const GOZ = gozJson as unknown as FeeScheduleTable;
const VALID_UUID = '11111111-1111-4111-8111-111111111111';

// A realistic GOÄ invoice: one clean line (250), one over the §5 limit (75 at
// 3.5 > 2.3), and one unknown Ziffer.
const SAMPLE = [
  'Praxis Dr. med. Mustermann',
  'Rechnungsdatum: 15.03.2026',
  'Rechnungs-Nr: R-2026-001',
  '250  Blutentnahme         2,3    5,36',
  '75   Krankheitsbericht    3,5   26,53',
  '99999 Unbekannte Leistung 1,0    9,99',
].join('\n');

describe('ocrResultsToText / meanConfidence', () => {
  it('joins recognised lines with newlines', () => {
    const results: OcrResult[] = [
      { text: 'a', bbox: { points: [] }, confidence: 1 },
      { text: 'b', bbox: { points: [] }, confidence: 1 },
    ];
    expect(ocrResultsToText(results)).toBe('a\nb');
  });

  it('averages confidence and defaults to 1 with no lines', () => {
    expect(meanConfidence([])).toBe(1);
    expect(
      meanConfidence([
        { text: 'a', bbox: { points: [] }, confidence: 0.6 },
        { text: 'b', bbox: { points: [] }, confidence: 0.8 },
      ]),
    ).toBeCloseTo(0.7);
  });
});

describe('buildScanResult', () => {
  it('detects the provider type from the OCR text and parses against the derived schedule', () => {
    const result = buildScanResult(textToOcrResults(SAMPLE), [GOAE, GOZ]);

    expect(result.providerType).toBe('arzt');
    expect(result.schedule).toBe('GOÄ');
    expect(result.parsed.invoiceDate).toBe('2026-03-15');
    expect(result.parsed.invoiceNumber).toBe('R-2026-001');
    expect(result.parsed.positions).toHaveLength(3);
    expect(result.parsed.totalAmount).toBeCloseTo(41.88);

    const [blut, bericht, unknown] = result.parsed.positions;
    expect(blut?.isValid).toBe(true);
    expect(bericht?.flags.some((f) => f.code === 'multiplier_exceeds_limit')).toBe(true);
    expect(unknown?.known).toBe(false);
  });

  it('detects a dentist invoice and parses against GOZ instead', () => {
    const dentistSample = [
      'Zahnarztpraxis Dr. med. dent. Mustermann',
      '30   Eingehende Untersuchung   2,3   14,51',
    ].join('\n');
    const result = buildScanResult(textToOcrResults(dentistSample), [GOAE, GOZ]);
    expect(result.providerType).toBe('zahnarzt');
    expect(result.schedule).toBe('GOZ');
    expect(result.parsed.positions[0]?.feeSchedule).toBe('GOZ');
  });

  it('accepts a single-table array', () => {
    const result = buildScanResult(textToOcrResults(SAMPLE), [GOAE]);
    expect(result.schedule).toBe('GOÄ');
    expect(result.parsed.positions).toHaveLength(3);
  });

  it('aligns per-position confidence by order, even for duplicate line text', () => {
    // Two identical position lines must keep their own confidences (no collapse
    // to a single min-merged value); the header line is ignored.
    const results: OcrResult[] = [
      { text: 'Rechnungsdatum: 15.03.2026', bbox: { points: [] }, confidence: 0.99 },
      { text: '250  Blutentnahme  2,3  5,36', bbox: { points: [] }, confidence: 0.4 },
      { text: '250  Blutentnahme  2,3  5,36', bbox: { points: [] }, confidence: 0.95 },
    ];
    const result = buildScanResult(results, [GOAE]);
    expect(result.parsed.positions).toHaveLength(2);
    expect(result.positionConfidence).toEqual([0.4, 0.95]);
  });

  it('keeps the recognised lines so the review screen can locate a position', () => {
    const results = textToOcrResults(SAMPLE);
    const result = buildScanResult(results, [GOAE]);
    expect(result.lines).toEqual(results);
  });
});

describe('positionLineIndices', () => {
  const line = (text: string, confidence = 1): OcrResult => ({
    text,
    bbox: { points: [] },
    confidence,
  });

  it('points at the source line of each parsed position, skipping header lines', () => {
    const results = textToOcrResults(SAMPLE);
    const indices = positionLineIndices(results);
    // SAMPLE has three header lines, then three position lines.
    expect(indices).toEqual([3, 4, 5]);
    expect(results[indices[0]!]?.text).toContain('250');
    expect(results[indices[2]!]?.text).toContain('99999');
  });

  it('stays index-aligned with the parsed positions', () => {
    const results = textToOcrResults(SAMPLE);
    const result = buildScanResult(results, [GOAE]);
    expect(result.positionLineIndex).toHaveLength(result.parsed.positions.length);
    // The k-th index must name a line whose Ziffer is the k-th position's.
    result.parsed.positions.forEach((position, k) => {
      const sourceLine = result.lines[result.positionLineIndex[k]!]!;
      expect(sourceLine.text).toContain(position.ziffer.replace(/^[ÄZ]/, ''));
    });
  });

  // Both dental special cases (#251) — the reason indices and confidences are
  // derived from one walk of the lines rather than two.
  it('counts a §9-GOZ practice-lab summary line, which parsePositionLine rejects', () => {
    const results = [
      line('30   Eingehende Untersuchung   2,3   14,51'),
      line('Auslagen nach §9 GOZ gemäß Praxislaborbeleg: 1.001,91'),
    ];
    expect(positionLineIndices(results)).toEqual([0, 1]);
  });

  it('truncates at an attached Eigenlabor-/Materialbeleg section marker', () => {
    const results = [
      line('30   Eingehende Untersuchung   2,3   14,51'),
      line('Eigenlaborbeleg'),
      line('40   Weitere Leistung   2,3   20,00'),
    ];
    // Everything from the marker onward is not extracted as a position.
    expect(positionLineIndices(results)).toEqual([0]);
  });

  it('agrees with positionConfidence line for line', () => {
    const results = [
      line('Rechnungsdatum: 15.03.2026', 0.99),
      line('250  Blutentnahme  2,3  5,36', 0.4),
      line('75   Krankheitsbericht  3,5  26,53', 0.7),
    ];
    const result = buildScanResult(results, [GOAE]);
    expect(result.positionLineIndex).toEqual([1, 2]);
    expect(result.positionConfidence).toEqual([0.4, 0.7]);
  });
});

describe('scheduleForProviderType', () => {
  it('maps zahnarzt/kieferorthopaede to GOZ and everything else to GOÄ', () => {
    expect(scheduleForProviderType('arzt')).toBe('GOÄ');
    expect(scheduleForProviderType('zahnarzt')).toBe('GOZ');
    expect(scheduleForProviderType('kieferorthopaede')).toBe('GOZ');
    expect(scheduleForProviderType('krankenhaus')).toBe('GOÄ');
    expect(scheduleForProviderType('sonstiges')).toBe('GOÄ');
  });
});

describe('toReviewPositions / toInvoicePayload', () => {
  const scan = buildScanResult(textToOcrResults(SAMPLE), [GOAE]);

  it('builds editable positions carrying flags', () => {
    const positions = toReviewPositions(scan);
    expect(positions[0]?.isValid).toBe(true);
    expect(positions[1]?.isValid).toBe(false);
    expect(positions[1]?.flagReason).toContain('Steigerungsfaktor');
  });

  it('detects Auslagenersatz (§10 GOÄ) from the description and overrides goaeCategory', () => {
    const auslagenScan = buildScanResult(
      textToOcrResults('250  Blutentnahme  2,3  5,36\n9999 Portopauschale Versandkosten 1,0  2,80'),
      [GOAE],
    );
    const positions = toReviewPositions(auslagenScan);
    expect(positions[0]?.goaeCategory).toBe('GOÄ');
    expect(positions[1]?.goaeCategory).toBe('Auslagenersatz');
  });

  function baseState(): ReviewState {
    return {
      insuredPersonId: VALID_UUID,
      invoiceDate: '2026-03-15',
      invoiceNumber: 'R-2026-001',
      providerName: 'Praxis Dr. med. Mustermann',
      providerType: 'arzt',
      schedule: 'GOÄ',
      positions: toReviewPositions(scan),
    };
  }

  it('serialises a confirmed review into a valid create payload', () => {
    const payload = toInvoicePayload(baseState());
    expect(payload.insured_person_id).toBe(VALID_UUID);
    expect(payload.provider_type).toBe('arzt');
    // No status on the create payload — the lifecycle starts in every track's ground state.
    expect('status' in payload).toBe(false);
    expect(payload.total_amount).toBeCloseTo(41.88);
    expect(payload.positions).toHaveLength(3);
    expect(payload.positions?.[0]?.goae_category).toBe('GOÄ');
    // Raw OCR text is omitted unless explicitly opted in (datenminimierung).
    expect(payload.ocr_raw).toBeNull();
  });

  it('recomputes the total from edited lines', () => {
    const state = baseState();
    state.positions = [
      {
        goaeNumber: '1',
        goaeCategory: 'GOÄ',
        quantity: 1,
        treatmentDate: null,
        description: 'Beratung',
        multiplier: 2.3,
        baseAmount: 4.66,
        chargedAmount: 10.72,
        isValid: true,
        flagReason: null,
        confidence: 1,
        lineIndex: null,
      },
    ];
    expect(toInvoicePayload(state).total_amount).toBeCloseTo(10.72);
  });

  it('includes the OCR raw text only on opt-in', () => {
    const state = { ...baseState(), ocrRaw: scan.ocrText };
    expect(toInvoicePayload(state).ocr_raw).toBe(scan.ocrText);
  });

  it('carries the Zahlungsziel and sends null when unset (#288)', () => {
    expect(toInvoicePayload(baseState()).payment_due_date).toBeNull();
    const state = { ...baseState(), paymentDueDate: '2026-03-29' };
    expect(toInvoicePayload(state).payment_due_date).toBe('2026-03-29');
  });

  it('rejects an invalid payload via the shared schema', () => {
    const state = { ...baseState(), insuredPersonId: 'not-a-uuid' };
    expect(() => toInvoicePayload(state)).toThrow(ZodError);
  });
});
