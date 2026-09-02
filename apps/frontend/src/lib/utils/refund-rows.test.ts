// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { InvoicePosition, InvoiceWithPositions } from '@selbstbehalt/shared';
import {
  buildCategoryRows,
  buildRefundRows,
  defaultPositionRefund,
  refundPositionsPayload,
} from './refund-rows';

const BASE_POSITION: InvoicePosition = {
  id: 'pos-1',
  invoice_id: 'inv-1',
  goae_number: '1',
  goae_category: 'GOÄ',
  quantity: 1,
  treatment_date: '2026-03-15',
  description: 'Beratung',
  multiplier: 2.3,
  base_amount: 4.66,
  charged_amount: 10.72,
  eligible_amount: 8.5,
  refund_amount: null,
  benefit_category: 'ambulant',
  is_valid: true,
  flag_reason: null,
};

function pos(over: Partial<InvoicePosition> = {}): InvoicePosition {
  return { ...BASE_POSITION, ...over };
}

function invoice(positions: InvoicePosition[]): InvoiceWithPositions {
  return {
    id: 'inv-1',
    insured_person_id: 'ip-1',
    invoice_date: '2026-03-15',
    invoice_number: 'R-1',
    provider_name: 'Dr. Mustermann',
    provider_type: 'arzt',
    payment_due_date: null,
    total_amount: positions.reduce((s, p) => s + p.charged_amount, 0),
    eligible_amount: null,
    self_paid_amount: 0,
    status: { review: 'geprüft', payment: 'offen', submission: 'eingereicht', paid_on: null },
    notes: null,
    ocr_raw: null,
    created_at: '2026-03-15T10:00:00Z',
    positions,
  };
}

describe('defaultPositionRefund', () => {
  it('pre-fills a new capture with the tariff estimate', () => {
    expect(defaultPositionRefund(pos(), 'create')).toBe(8.5);
  });

  it('falls back to the charged amount when no estimate exists', () => {
    expect(defaultPositionRefund(pos({ eligible_amount: null }), 'create')).toBe(10.72);
  });

  it('keeps a zero estimate — "nichts erstattungsfähig" is not "unbekannt"', () => {
    expect(defaultPositionRefund(pos({ eligible_amount: 0 }), 'create')).toBe(0);
  });

  it('pre-fills a correction with the stored refund', () => {
    expect(defaultPositionRefund(pos({ refund_amount: 7.25 }), 'edit')).toBe(7.25);
  });

  it('falls back to the estimate when correcting a position without a stored refund', () => {
    expect(defaultPositionRefund(pos(), 'edit')).toBe(8.5);
  });
});

describe('buildRefundRows', () => {
  it('maps every position to an editable row', () => {
    const rows = buildRefundRows(
      invoice([pos(), pos({ id: 'pos-2', goae_number: '5' })]),
      'create',
    );
    expect(rows).toEqual([
      expect.objectContaining({ id: 'pos-1', goae_number: '1', refund_amount: 8.5 }),
      expect.objectContaining({ id: 'pos-2', goae_number: '5', refund_amount: 8.5 }),
    ]);
  });

  it('normalises a missing description to null', () => {
    const [row] = buildRefundRows(invoice([pos({ description: null })]), 'create');
    expect(row!.description).toBeNull();
  });
});

describe('buildCategoryRows', () => {
  it('groups positions by Leistungsbereich, in order of first appearance', () => {
    const rows = buildCategoryRows(
      invoice([
        pos({
          id: 'a',
          benefit_category: 'zahnbehandlung',
          charged_amount: 20,
          eligible_amount: 8,
        }),
        pos({ id: 'b', benefit_category: 'ambulant', charged_amount: 10, eligible_amount: 5 }),
        pos({ id: 'c', benefit_category: 'zahnbehandlung', charged_amount: 5, eligible_amount: 2 }),
      ]),
      'create',
    );
    expect(rows.map((r) => r.category)).toEqual(['zahnbehandlung', 'ambulant']);
    expect(rows[0]).toMatchObject({
      label: 'Zahnbehandlung',
      charged_amount: 25,
      eligible_amount: 10,
      refund_amount: 10,
    });
  });

  it('leaves the category estimate unknown (null) while no position carries one', () => {
    const rows = buildCategoryRows(invoice([pos({ eligible_amount: null })]), 'create');
    expect(rows[0]!.eligible_amount).toBeNull();
    expect(rows[0]!.refund_amount).toBe(10.72);
  });

  it('sums the stored refunds when correcting', () => {
    const rows = buildCategoryRows(
      invoice([pos({ refund_amount: 7.25 }), pos({ id: 'pos-2', refund_amount: 1.1 })]),
      'edit',
    );
    expect(rows[0]!.refund_amount).toBe(8.35);
  });

  it('buckets a legacy position without a stored category by provider type', () => {
    const rows = buildCategoryRows(invoice([pos({ benefit_category: null })]), 'create');
    expect(rows[0]!.category).toBe('ambulant');
  });

  it('returns no rows for an invoice without positions', () => {
    expect(buildCategoryRows(invoice([]), 'create')).toEqual([]);
  });
});

describe('refundPositionsPayload', () => {
  const inv = invoice([
    pos({ id: 'pos-1', eligible_amount: 30, charged_amount: 40 }),
    pos({ id: 'pos-2', eligible_amount: 10, charged_amount: 20 }),
  ]);

  it('passes the per-position rows through verbatim', () => {
    const rows = buildRefundRows(inv, 'create');
    rows[1]!.refund_amount = 0;
    expect(refundPositionsPayload(inv, 'position', rows, [])).toEqual([
      { id: 'pos-1', refund_amount: 30 },
      { id: 'pos-2', refund_amount: 0 },
    ]);
  });

  it('distributes a category amount across that category’s positions', () => {
    const categoryRows = buildCategoryRows(inv, 'create');
    categoryRows[0]!.refund_amount = 20;
    expect(refundPositionsPayload(inv, 'category', [], categoryRows)).toEqual([
      { id: 'pos-1', refund_amount: 15 },
      { id: 'pos-2', refund_amount: 5 },
    ]);
  });

  it('treats an emptied category field as an Ablehnung (0)', () => {
    const categoryRows = buildCategoryRows(inv, 'create');
    // A number input hands back '' once cleared.
    categoryRows[0]!.refund_amount = '' as unknown as number;
    expect(refundPositionsPayload(inv, 'category', [], categoryRows)).toEqual([
      { id: 'pos-1', refund_amount: 0 },
      { id: 'pos-2', refund_amount: 0 },
    ]);
  });

  it('refunds 0 for a position whose category was not entered at all', () => {
    expect(refundPositionsPayload(inv, 'category', [], [])).toEqual([
      { id: 'pos-1', refund_amount: 0 },
      { id: 'pos-2', refund_amount: 0 },
    ]);
  });
});
