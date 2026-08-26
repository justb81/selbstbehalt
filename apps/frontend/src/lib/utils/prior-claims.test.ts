// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { computeErstattung } from './erstattungs-engine';
import {
  aggregatePriorClaims,
  patientAgeAt,
  referenceLeistungsjahr,
  type PriorClaimsInvoice,
} from './prior-claims';

const GEPRUEFT = {
  review: 'geprüft',
  submission: 'nicht_eingereicht',
} satisfies PriorClaimsInvoice['status'];

/** A checked, not-yet-submitted Hilfsmittel invoice with a single position. */
function invoice(
  id: string,
  overrides: Partial<PriorClaimsInvoice> & {
    treatmentDate?: string;
    eligible?: number | null;
    refund?: number | null;
  } = {},
): PriorClaimsInvoice {
  const { treatmentDate = '2026-03-01', eligible = 250, refund = null, ...rest } = overrides;
  return {
    id,
    provider_type: 'sanitaetshaus',
    status: GEPRUEFT,
    positions: [
      {
        goae_category: 'Arznei-/Hilfsmittel',
        benefit_category: 'hilfsmittel',
        treatment_date: treatmentDate,
        charged_amount: 250,
        eligible_amount: eligible,
        refund_amount: refund,
      },
    ],
    ...rest,
  };
}

describe('aggregatePriorClaims — windows', () => {
  it('fills all three windows from the same position', () => {
    const prior = aggregatePriorClaims({
      invoices: [invoice('inv-1')],
      year: 2026,
      coverageStart: '2024-01-01',
    });
    expect(prior).toEqual({
      jahr: { hilfsmittel: 250 },
      lebenslang: { hilfsmittel: 250 },
      annual_staffel: { hilfsmittel: 250 },
    });
  });

  it('counts a position of another Leistungsjahr only outside the jahr window', () => {
    const prior = aggregatePriorClaims({
      invoices: [invoice('inv-1', { treatmentDate: '2025-11-20' })],
      year: 2026,
      coverageStart: '2024-01-01',
    });
    expect(prior.jahr).toEqual({});
    expect(prior.lebenslang).toEqual({ hilfsmittel: 250 });
    expect(prior.annual_staffel).toEqual({ hilfsmittel: 250 });
  });

  it('keeps a position from before the coverage start out of the annual_staffel window', () => {
    const prior = aggregatePriorClaims({
      invoices: [invoice('inv-1', { treatmentDate: '2023-05-04' })],
      year: 2023,
      coverageStart: '2024-01-01',
    });
    expect(prior.annual_staffel).toEqual({});
    // A lifelong cap is measured over the whole history.
    expect(prior.lebenslang).toEqual({ hilfsmittel: 250 });
    expect(prior.jahr).toEqual({ hilfsmittel: 250 });
  });

  it('counts a position on the coverage start day itself', () => {
    const prior = aggregatePriorClaims({
      invoices: [invoice('inv-1', { treatmentDate: '2024-01-01' })],
      year: 2024,
      coverageStart: '2024-01-01',
    });
    expect(prior.annual_staffel).toEqual({ hilfsmittel: 250 });
  });
});

describe('aggregatePriorClaims — which invoices and amounts count', () => {
  it('excludes the invoice being computed', () => {
    const prior = aggregatePriorClaims({
      invoices: [invoice('inv-1'), invoice('inv-2')],
      excludeInvoiceId: 'inv-2',
      year: 2026,
      coverageStart: '2024-01-01',
    });
    expect(prior.jahr).toEqual({ hilfsmittel: 250 });
  });

  it('skips unreviewed invoices', () => {
    const prior = aggregatePriorClaims({
      invoices: [
        invoice('inv-1', { status: { review: 'neu', submission: 'nicht_eingereicht' } }),
        invoice('inv-2'),
      ],
      year: 2026,
      coverageStart: '2024-01-01',
    });
    expect(prior.jahr).toEqual({ hilfsmittel: 250 });
  });

  it('prefers the realised refund over the estimate once reimbursed', () => {
    const prior = aggregatePriorClaims({
      invoices: [
        invoice('inv-1', {
          status: { review: 'geprüft', submission: 'erstattet' },
          eligible: 250,
          refund: 180,
        }),
      ],
      year: 2026,
      coverageStart: '2024-01-01',
    });
    expect(prior.jahr).toEqual({ hilfsmittel: 180 });
  });

  it('treats a reimbursed position without a refund amount as 0', () => {
    const prior = aggregatePriorClaims({
      invoices: [
        invoice('inv-1', {
          status: { review: 'geprüft', submission: 'erstattet' },
          eligible: 250,
          refund: null,
        }),
      ],
      year: 2026,
      coverageStart: '2024-01-01',
    });
    expect(prior.jahr).toEqual({});
  });

  it('ignores positions whose eligible amount is unknown', () => {
    const prior = aggregatePriorClaims({
      invoices: [invoice('inv-1', { eligible: null })],
      year: 2026,
      coverageStart: '2024-01-01',
    });
    expect(prior.lebenslang).toEqual({});
  });

  it('sums per category across invoices and rounds to cents', () => {
    const prior = aggregatePriorClaims({
      invoices: [
        invoice('inv-1', { eligible: 10.1 }),
        invoice('inv-2', { eligible: 20.2 }),
        {
          id: 'inv-3',
          provider_type: 'zahnarzt',
          status: GEPRUEFT,
          positions: [
            {
              goae_category: 'GOZ',
              benefit_category: 'zahnersatz',
              treatment_date: '2026-02-02',
              charged_amount: 900,
              eligible_amount: 720,
            },
          ],
        },
      ],
      year: 2026,
      coverageStart: '2024-01-01',
    });
    expect(prior.jahr).toEqual({ hilfsmittel: 30.3, zahnersatz: 720 });
  });

  it('resolves a legacy position without benefit_category from the provider type', () => {
    const prior = aggregatePriorClaims({
      invoices: [
        {
          id: 'inv-legacy',
          provider_type: 'zahnarzt',
          status: GEPRUEFT,
          positions: [
            {
              goae_category: 'GOZ',
              benefit_category: null,
              treatment_date: '2026-04-04',
              charged_amount: 100,
              eligible_amount: 80,
            },
          ],
        },
      ],
      year: 2026,
      coverageStart: '2024-01-01',
    });
    expect(prior.jahr).toEqual({ zahnbehandlung: 80 });
  });

  it('falls back to the "sonstiges" area when the invoice has no provider type', () => {
    const prior = aggregatePriorClaims({
      invoices: [
        {
          id: 'inv-legacy',
          provider_type: null,
          status: GEPRUEFT,
          positions: [
            {
              goae_category: 'GOÄ',
              benefit_category: null,
              treatment_date: '2026-04-04',
              charged_amount: 100,
              eligible_amount: 80,
            },
          ],
        },
      ],
      year: 2026,
      coverageStart: '2024-01-01',
    });
    expect(prior.jahr).toEqual({ sonstiges: 80 });
  });
});

describe('referenceLeistungsjahr', () => {
  it('takes the year carrying the largest share of the billed amount', () => {
    const year = referenceLeistungsjahr(
      [
        { treatment_date: '2025-12-28', charged_amount: 100 },
        { treatment_date: '2026-01-04', charged_amount: 400 },
      ],
      '2026-01-31',
    );
    expect(year).toBe(2026);
  });

  it('prefers the earlier year on a tie', () => {
    const year = referenceLeistungsjahr(
      [
        { treatment_date: '2026-01-04', charged_amount: 100 },
        { treatment_date: '2025-12-28', charged_amount: 100 },
      ],
      '2026-01-31',
    );
    expect(year).toBe(2025);
  });

  it('falls back to the invoice date when no position is dated', () => {
    expect(
      referenceLeistungsjahr([{ treatment_date: '', charged_amount: 100 }], '2026-01-31'),
    ).toBe(2026);
    expect(referenceLeistungsjahr([], '2024-07-01')).toBe(2024);
  });
});

describe('patientAgeAt', () => {
  it('returns completed years at the reference date', () => {
    expect(patientAgeAt('2010-06-15', '2026-06-14')).toBe(15);
    expect(patientAgeAt('2010-06-15', '2026-06-15')).toBe(16);
  });

  it('returns undefined for an unknown birth date', () => {
    expect(patientAgeAt(null, '2026-06-15')).toBeUndefined();
    expect(patientAgeAt(undefined, '2026-06-15')).toBeUndefined();
  });

  it('returns undefined for a birth date after the reference date', () => {
    expect(patientAgeAt('2030-01-01', '2026-06-15')).toBeUndefined();
  });
});

describe('aggregatePriorClaims + computeErstattung — issue #370 scenarios', () => {
  it('leaves only the rest of a yearly limit for the second invoice', () => {
    // Tarif: Hilfsmittel max. 300 €/Jahr. First invoice 250 € → 250 €; the second
    // 250 € in the same year must come out at 50 €, not 250 € again.
    const first = invoice('inv-1', { treatmentDate: '2026-02-01', eligible: 250 });
    const second = invoice('inv-2', { treatmentDate: '2026-05-01' });
    const result = computeErstattung({
      positions: [{ category: 'hilfsmittel', chargedAmount: 250, treatmentDate: '2026-05-01' }],
      benefits: {
        benefits: [{ category: 'hilfsmittel', limits: [{ scope: 'jahr', max_amount: 300 }] }],
      },
      invoiceDate: '2026-05-02',
      coverageStart: '2024-01-01',
      priorClaims: aggregatePriorClaims({
        invoices: [first, second],
        excludeInvoiceId: 'inv-2',
        year: 2026,
        coverageStart: '2024-01-01',
      }),
    });
    expect(result.eligibleAmount).toBe(50);
    expect(result.byCategory[0]?.cappedBy).toBe('limit');
  });

  it('caps the second Zahnersatz invoice at the rest of the Aufbaujahr', () => {
    // Zahnstaffel: 1 000 € cumulative in policy year 1. Two 800-€ invoices must not
    // both come out at 800 €.
    const stored: PriorClaimsInvoice = {
      id: 'inv-1',
      provider_type: 'zahnarzt',
      status: GEPRUEFT,
      positions: [
        {
          goae_category: 'GOZ',
          benefit_category: 'zahnersatz',
          treatment_date: '2026-02-01',
          charged_amount: 800,
          eligible_amount: 800,
        },
      ],
    };
    const result = computeErstattung({
      positions: [{ category: 'zahnersatz', chargedAmount: 800, treatmentDate: '2026-05-01' }],
      benefits: {
        benefits: [
          {
            category: 'zahnersatz',
            annual_staffel: [
              { policy_year: 1, cumulative_cap: 1000 },
              { policy_year: 2, cumulative_cap: null },
            ],
          },
        ],
      },
      invoiceDate: '2026-05-02',
      coverageStart: '2026-01-01',
      priorClaims: aggregatePriorClaims({
        invoices: [stored],
        year: 2026,
        coverageStart: '2026-01-01',
      }),
    });
    expect(result.eligibleAmount).toBe(200);
    expect(result.byCategory[0]?.cappedBy).toBe('annual_staffel');
  });

  it('applies an age-bound limit once the birth date is known', () => {
    const benefits = {
      benefits: [
        {
          category: 'kieferorthopaedie' as const,
          limits: [{ scope: 'behandlung' as const, max_amount: 500, age_max: 18 }],
        },
      ],
    };
    const positions = [{ category: 'kieferorthopaedie' as const, chargedAmount: 800 }];
    const known = computeErstattung({
      positions,
      benefits,
      invoiceDate: '2026-05-02',
      coverageStart: '2024-01-01',
      patientAge: patientAgeAt('2014-01-01', '2026-05-02'),
    });
    expect(known.eligibleAmount).toBe(500);

    const unknown = computeErstattung({
      positions,
      benefits,
      invoiceDate: '2026-05-02',
      coverageStart: '2024-01-01',
      patientAge: patientAgeAt(null, '2026-05-02'),
    });
    expect(unknown.eligibleAmount).toBe(800);
    expect(unknown.byCategory[0]?.note).toContain('Alter unbekannt');
  });
});
