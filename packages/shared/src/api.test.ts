// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import {
  breHistorySchema,
  errorBodySchema,
  healthBodySchema,
  importResultSchema,
  multiplierDistributionSchema,
  positionYearRollupSchema,
  reductionRollupSchema,
  validationRollupSchema,
  yearStatsSchema,
} from './api.js';

describe('errorBodySchema', () => {
  it('accepts the unified error envelope', () => {
    expect(
      errorBodySchema.safeParse({ error: { status: 404, message: 'Not Found' } }).success,
    ).toBe(true);
  });

  it('accepts an empty message (an HTTPException thrown without one)', () => {
    expect(errorBodySchema.safeParse({ error: { status: 404, message: '' } }).success).toBe(true);
  });

  it('rejects a missing status or wrong types', () => {
    expect(errorBodySchema.safeParse({ error: { message: 'x' } }).success).toBe(false);
    expect(errorBodySchema.safeParse({ error: { status: '404', message: 'x' } }).success).toBe(
      false,
    );
    expect(errorBodySchema.safeParse('nope').success).toBe(false);
  });
});

describe('healthBodySchema', () => {
  it('accepts a healthy probe response', () => {
    expect(
      healthBodySchema.safeParse({ status: 'ok', service: 'selbstbehalt-backend', db: 'up' })
        .success,
    ).toBe(true);
  });

  it('accepts a degraded response', () => {
    expect(
      healthBodySchema.safeParse({
        status: 'degraded',
        service: 'selbstbehalt-backend',
        db: 'down',
      }).success,
    ).toBe(true);
  });

  it('rejects unknown enum values', () => {
    expect(healthBodySchema.safeParse({ status: 'maybe', service: 'x', db: 'up' }).success).toBe(
      false,
    );
  });
});

describe('yearStatsSchema', () => {
  const valid = {
    year: 2026,
    invoice_count: 3,
    total_amount: 255,
    eligible_amount: 187.5,
    self_paid_amount: 67.5,
    refund_amount: 120,
    bre_amount: 452.3,
  };

  it('accepts a complete year roll-up', () => {
    expect(yearStatsSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects negative sums and non-integer counts', () => {
    expect(yearStatsSchema.safeParse({ ...valid, total_amount: -1 }).success).toBe(false);
    expect(yearStatsSchema.safeParse({ ...valid, invoice_count: 1.5 }).success).toBe(false);
  });
});

describe('breHistorySchema', () => {
  it('accepts an insured-person ladder with a nullable projection', () => {
    const result = breHistorySchema.safeParse({
      insured_person_id: '11111111-1111-4111-8111-111111111111',
      years: [
        { year: 2025, streak_years: 0, bre_amount: 0, projected_bre: 185 },
        { year: 2026, streak_years: 1, bre_amount: 185, projected_bre: null },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-UUID insured-person id', () => {
    expect(breHistorySchema.safeParse({ insured_person_id: 'nope', years: [] }).success).toBe(
      false,
    );
  });
});

describe('positionYearRollupSchema', () => {
  it('accepts a per-year positions roll-up', () => {
    const result = positionYearRollupSchema.safeParse({
      insured_person_id: '11111111-1111-4111-8111-111111111111',
      years: [
        { year: 2025, charged_amount: 300, eligible_amount: 230, refund_amount: 80 },
        { year: 2026, charged_amount: 100, eligible_amount: 0, refund_amount: 0 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative amounts', () => {
    expect(
      positionYearRollupSchema.safeParse({
        insured_person_id: '11111111-1111-4111-8111-111111111111',
        years: [{ year: 2025, charged_amount: -1, eligible_amount: 0, refund_amount: 0 }],
      }).success,
    ).toBe(false);
  });
});

describe('reductionRollupSchema', () => {
  const valid = {
    group_by: 'tariff',
    groups: [
      {
        group: 'Komfort',
        eligible_amount: 500,
        refund_amount: 420,
        reduction_amount: 80,
        rejection_count: 1,
        rejection_amount: 50,
        open_count: 2,
      },
      {
        group: null,
        eligible_amount: 0,
        refund_amount: 0,
        reduction_amount: 0,
        rejection_count: 0,
        rejection_amount: 0,
        open_count: 0,
      },
    ],
  };

  it('accepts groups including a null group value', () => {
    expect(reductionRollupSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects an unknown group_by dimension', () => {
    expect(reductionRollupSchema.safeParse({ ...valid, group_by: 'nope' }).success).toBe(false);
  });
});

describe('validationRollupSchema', () => {
  it('accepts flag categories and a multiplier distribution', () => {
    const result = validationRollupSchema.safeParse({
      flags: [
        { category: 'steigerungsfaktor', count: 3, charged_amount: 210 },
        { category: 'sonstiges', count: 1, charged_amount: 50 },
      ],
      multiplier_distribution: [
        {
          goae_category: 'GOÄ',
          count: 10,
          avg_multiplier: 2.1,
          min_multiplier: 1,
          max_multiplier: 3.5,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown flag category', () => {
    expect(
      validationRollupSchema.safeParse({
        flags: [{ category: 'nope', count: 1, charged_amount: 10 }],
        multiplier_distribution: [],
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown goae_category in the multiplier distribution', () => {
    expect(
      multiplierDistributionSchema.safeParse({
        goae_category: 'nope',
        count: 1,
        avg_multiplier: 1,
        min_multiplier: 1,
        max_multiplier: 1,
      }).success,
    ).toBe(false);
  });
});

describe('importResultSchema', () => {
  it('accepts an import result with and without a backup path', () => {
    expect(
      importResultSchema.safeParse({
        status: 'ok',
        tables_imported: 6,
        rows_imported: 42,
        backup_path: '/app/db/pkv.sqlite.bak-2026-06-27',
      }).success,
    ).toBe(true);
    expect(
      importResultSchema.safeParse({
        status: 'ok',
        tables_imported: 6,
        rows_imported: 0,
        backup_path: null,
      }).success,
    ).toBe(true);
  });

  it('rejects a non-ok status', () => {
    expect(
      importResultSchema.safeParse({
        status: 'failed',
        tables_imported: 6,
        rows_imported: 0,
        backup_path: null,
      }).success,
    ).toBe(false);
  });
});
