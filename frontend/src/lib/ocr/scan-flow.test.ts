// SPDX-License-Identifier: Apache-2.0
import { ZodError } from 'zod';
import { describe, expect, it } from 'vitest';

import {
  buildScanResult,
  defaultProviderType,
  meanConfidence,
  ocrResultsToText,
  toInvoicePayload,
  toReviewPositions,
  type ReviewState,
} from './scan-flow';
import { textToOcrResults } from './scan-ocr';
import type { OcrResult } from './types';

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
  it('parses an invoice against the chosen schedule', () => {
    const result = buildScanResult(textToOcrResults(SAMPLE), 'GOÄ');

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

  it('maps per-line OCR confidence onto positions by raw text', () => {
    const results: OcrResult[] = [
      { text: '250  Blutentnahme         2,3    5,36', bbox: { points: [] }, confidence: 0.4 },
      { text: '75   Krankheitsbericht    3,5   26,53', bbox: { points: [] }, confidence: 0.95 },
    ];
    const result = buildScanResult(results, 'GOÄ');
    expect(result.positionConfidence[0]).toBeCloseTo(0.4);
    expect(result.positionConfidence[1]).toBeCloseTo(0.95);
  });
});

describe('defaultProviderType', () => {
  it('maps schedules to a sensible provider type', () => {
    expect(defaultProviderType('GOÄ')).toBe('arzt');
    expect(defaultProviderType('GOZ')).toBe('zahnarzt');
    expect(defaultProviderType('GOT')).toBe('sonstiges');
  });
});

describe('toReviewPositions / toInvoicePayload', () => {
  const scan = buildScanResult(textToOcrResults(SAMPLE), 'GOÄ');

  it('builds editable positions carrying flags', () => {
    const positions = toReviewPositions(scan.parsed);
    expect(positions[0]?.isValid).toBe(true);
    expect(positions[1]?.isValid).toBe(false);
    expect(positions[1]?.flagReason).toContain('Steigerungsfaktor');
  });

  function baseState(): ReviewState {
    return {
      insuredPersonId: VALID_UUID,
      invoiceDate: '2026-03-15',
      invoiceNumber: 'R-2026-001',
      providerName: 'Praxis Dr. med. Mustermann',
      providerType: 'arzt',
      schedule: 'GOÄ',
      positions: toReviewPositions(scan.parsed),
    };
  }

  it('serialises a confirmed review into a valid create payload', () => {
    const payload = toInvoicePayload(baseState());
    expect(payload.insured_person_id).toBe(VALID_UUID);
    expect(payload.provider_type).toBe('arzt');
    expect(payload.status).toBe('neu');
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
        description: 'Beratung',
        multiplier: 2.3,
        baseAmount: 4.66,
        chargedAmount: 10.72,
        isValid: true,
        flagReason: null,
      },
    ];
    expect(toInvoicePayload(state).total_amount).toBeCloseTo(10.72);
  });

  it('includes the OCR raw text only on opt-in', () => {
    const state = { ...baseState(), ocrRaw: scan.ocrText };
    expect(toInvoicePayload(state).ocr_raw).toBe(scan.ocrText);
  });

  it('rejects an invalid payload via the shared schema', () => {
    const state = { ...baseState(), insuredPersonId: 'not-a-uuid' };
    expect(() => toInvoicePayload(state)).toThrow(ZodError);
  });
});
