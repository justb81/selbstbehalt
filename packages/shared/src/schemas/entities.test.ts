// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { invoiceStatusValues, goaeCategoryValues } from '../enums.js';
import { personCreateSchema, personUpdateSchema } from './person.js';
import { contractCreateSchema } from './contract.js';
import { insuredPersonCreateSchema, breStructureSchema } from './insured-person.js';
import { invoiceCreateSchema, invoiceSchema } from './invoice.js';
import { invoicePositionCreateSchema } from './invoice-position.js';
import { submissionCreateSchema } from './submission.js';
import { brePeriodCreateSchema } from './bre-period.js';

const UUID = '3f9a8c2e-1d4b-4c6a-9e2f-7b1c0d5e6a7f';

describe('enums', () => {
  it('expose the values from §3.2', () => {
    expect(invoiceStatusValues).toContain('selbst_gezahlt');
    expect(goaeCategoryValues).toContain('GOÄ');
  });
});

describe('personCreateSchema', () => {
  it('requires a non-empty name', () => {
    expect(personCreateSchema.safeParse({ name: '' }).success).toBe(false);
    expect(personCreateSchema.safeParse({ name: 'Erika Mustermann' }).success).toBe(true);
  });

  it('rejects unknown fields outright (role is no longer part of a person)', () => {
    // role was removed in favour of the policyholder/insured relations. The
    // schema is strict, so an unknown key is a hard rejection (not a silent
    // drop) — a typo'd field name surfaces as a 400 instead of being lost.
    const result = personCreateSchema.safeParse({ name: 'X', role: 'primary' });
    expect(result.success).toBe(false);
  });

  it('partial update allows an empty object', () => {
    expect(personUpdateSchema.safeParse({}).success).toBe(true);
  });
});

describe('contractCreateSchema', () => {
  const base = {
    policyholder_id: UUID,
    insurer_name: 'DKV',
    type: 'vollversicherung' as const,
    start_date: '2024-01-01',
  };

  it('accepts a minimal valid contract (Hauptvertrag only)', () => {
    expect(contractCreateSchema.safeParse(base).success).toBe(true);
  });

  it('requires the Versicherungsnehmer (policyholder_id)', () => {
    const withoutHolder = { ...base, policyholder_id: undefined };
    expect(contractCreateSchema.safeParse(withoutHolder).success).toBe(false);
  });

  it('rejects an unknown contract type', () => {
    expect(contractCreateSchema.safeParse({ ...base, type: 'reise' }).success).toBe(false);
  });
});

describe('insuredPersonCreateSchema', () => {
  const base = {
    contract_id: UUID,
    person_id: UUID,
    kvnr: 'A123456789',
    monthly_premium: 450,
  };

  it('accepts a minimal valid insured person', () => {
    expect(insuredPersonCreateSchema.safeParse(base).success).toBe(true);
  });

  it('requires the contract and person it links', () => {
    expect(insuredPersonCreateSchema.safeParse({ ...base, contract_id: undefined }).success).toBe(
      false,
    );
    expect(insuredPersonCreateSchema.safeParse({ ...base, person_id: undefined }).success).toBe(
      false,
    );
  });

  it('rejects a typo’d field instead of silently dropping it', () => {
    // `self_retension` is a typo for `self_retention`; strict mode flags it as a
    // 400 rather than discarding the deductible and letting the DB default to 0.
    expect(insuredPersonCreateSchema.safeParse({ ...base, self_retension: 600 }).success).toBe(
      false,
    );
  });

  it('rejects an unknown key inside a nested included_benefits block', () => {
    const result = insuredPersonCreateSchema.safeParse({
      ...base,
      included_benefits: {
        benefits: [{ category: 'ambulant', tiers: [{ up_to: null, pct: 100 }], typo: true }],
      },
    });
    expect(result.success).toBe(false);
  });

  it('validates a nested bre_structure', () => {
    const result = insuredPersonCreateSchema.safeParse({
      ...base,
      bre_structure: {
        type: 'staffel',
        levels: [{ leistungsfrei_years: 1, bre_months: 1, pct_of_premium: 100 }],
        current_streak_start: '2024-01-01',
      },
      included_benefits: {
        benefits: [
          { category: 'ambulant', tiers: [{ up_to: null, pct: 100 }] },
          { category: 'zahnersatz', tiers: [{ up_to: null, pct: 80 }] },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a bre_structure with no levels', () => {
    expect(breStructureSchema.safeParse({ type: 'staffel', levels: [] }).success).toBe(false);
  });

  it('rejects pct_of_premium above 100', () => {
    expect(
      breStructureSchema.safeParse({
        type: 'staffel',
        levels: [{ leistungsfrei_years: 1, bre_months: 1, pct_of_premium: 101 }],
      }).success,
    ).toBe(false);
  });
});

describe('invoiceCreateSchema', () => {
  const base = {
    insured_person_id: UUID,
    invoice_date: '2026-06-01',
    provider_name: 'Dr. Müller',
    total_amount: 85,
  };

  it('accepts a minimal valid invoice and defaults stay omittable', () => {
    expect(invoiceCreateSchema.safeParse(base).success).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(invoiceCreateSchema.safeParse({ ...base, status: 'unterwegs' }).success).toBe(false);
  });

  it('read schema requires server-managed fields', () => {
    expect(invoiceSchema.safeParse(base).success).toBe(false);
    expect(
      invoiceSchema.safeParse({
        ...base,
        id: UUID,
        created_at: '2026-06-01T10:00:00Z',
        self_paid_amount: 0,
        status: 'neu',
      }).success,
    ).toBe(true);
  });
});

describe('invoicePositionCreateSchema', () => {
  const base = {
    invoice_id: UUID,
    goae_number: '0340',
    multiplier: 2.3,
    base_amount: 20.11,
    charged_amount: 46.25,
  };

  it('accepts a valid position', () => {
    expect(invoicePositionCreateSchema.safeParse(base).success).toBe(true);
  });

  it('rejects a non-positive multiplier', () => {
    expect(invoicePositionCreateSchema.safeParse({ ...base, multiplier: 0 }).success).toBe(false);
  });
});

describe('submissionCreateSchema', () => {
  it('accepts a submission with an ISO datetime', () => {
    expect(
      submissionCreateSchema.safeParse({
        invoice_id: UUID,
        submitted_at: '2026-06-02T09:00:00Z',
        submitted_via: 'email',
        expected_refund: 62.5,
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown submission channel', () => {
    expect(
      submissionCreateSchema.safeParse({ invoice_id: UUID, submitted_via: 'fax' }).success,
    ).toBe(false);
  });
});

describe('brePeriodCreateSchema', () => {
  it('accepts a valid period', () => {
    expect(
      brePeriodCreateSchema.safeParse({ insured_person_id: UUID, year: 2026, streak_years: 1 })
        .success,
    ).toBe(true);
  });

  it('rejects an implausible year', () => {
    expect(brePeriodCreateSchema.safeParse({ insured_person_id: UUID, year: 1700 }).success).toBe(
      false,
    );
  });

  it('rejects a non-integer year', () => {
    expect(brePeriodCreateSchema.safeParse({ insured_person_id: UUID, year: 2026.5 }).success).toBe(
      false,
    );
  });
});
