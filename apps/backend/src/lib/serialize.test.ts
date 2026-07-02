// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for the wire↔Drizzle translation layer. These exercise both the
// "field present" and "field omitted" branches of the partial update mappers
// (the routes only ever touch a handful of fields per request), and round-trip
// the serializers with both populated and null columns.

import { describe, expect, it } from 'vitest';

import {
  serializeContract,
  serializeInsuredPerson,
  serializeInvoice,
  serializePosition,
  serializeSubmission,
  toContractInsert,
  toContractUpdate,
  toInsuredPersonInsert,
  toInsuredPersonUpdate,
  toInvoiceInsert,
  toInvoiceUpdate,
  toPositionInsert,
  toSubmissionInsert,
  toSubmissionUpdate,
} from './serialize.js';

const ID = '3f9a8c2e-1d4b-4c6a-9e2f-7b1c0d5e6a7f';
const NOW = '2026-06-01T10:00:00.000Z';

describe('contract mapping', () => {
  it('serializes a fully populated row', () => {
    const result = serializeContract({
      id: ID,
      policyholderId: ID,
      insurerName: 'DKV',
      contractNumber: 'KV-1',
      type: 'vollversicherung',
      startDate: '2024-01-01',
      endDate: '2030-01-01',
      notes: 'x',
      createdAt: NOW,
    });
    expect(result).toMatchObject({
      id: ID,
      policyholder_id: ID,
      insurer_name: 'DKV',
      contract_number: 'KV-1',
      type: 'vollversicherung',
      created_at: NOW,
    });
  });

  it('serializes a row with nullable columns null', () => {
    const result = serializeContract({
      id: ID,
      policyholderId: ID,
      insurerName: 'DKV',
      contractNumber: null,
      type: 'beihilfe',
      startDate: '2024-01-01',
      endDate: null,
      notes: null,
      createdAt: NOW,
    });
    expect(result.contract_number).toBeNull();
    expect(result.end_date).toBeNull();
  });

  it('maps a create payload to insert values', () => {
    const insert = toContractInsert({
      policyholder_id: ID,
      insurer_name: 'DKV',
      type: 'zusatztarif',
      start_date: '2024-01-01',
    });
    expect(insert).toMatchObject({ policyholderId: ID, insurerName: 'DKV', type: 'zusatztarif' });
  });

  it('maps every field on a full update', () => {
    const update = toContractUpdate({
      policyholder_id: ID,
      insurer_name: 'Allianz',
      contract_number: 'KV-2',
      type: 'vollversicherung',
      start_date: '2025-01-01',
      end_date: '2031-01-01',
      notes: 'n',
    });
    expect(Object.keys(update)).toHaveLength(7);
    expect(update.insurerName).toBe('Allianz');
  });

  it('produces an empty patch for an empty update', () => {
    expect(toContractUpdate({})).toEqual({});
  });
});

describe('insured-person mapping', () => {
  it('serializes a fully populated row', () => {
    const result = serializeInsuredPerson({
      id: ID,
      contractId: ID,
      personId: ID,
      kvnr: 'A123456789',
      tariffName: 'Komfort',
      monthlyPremium: 452.3,
      selfRetention: 600,
      breStructure: {
        type: 'staffel',
        levels: [{ claim_free_years: 1, bre_years: 1, pct_of_premium: 100 }],
      },
      includedBenefits: {
        benefits: [{ category: 'ambulant', tiers: [{ up_to: null, pct: 100 }] }],
      },
      startDate: '2024-01-01',
      endDate: '2030-01-01',
      notes: 'x',
      createdAt: NOW,
    });
    expect(result).toMatchObject({
      id: ID,
      contract_id: ID,
      person_id: ID,
      kvnr: 'A123456789',
      self_retention: 600,
      created_at: NOW,
    });
    expect(result.bre_structure?.levels[0]?.bre_years).toBe(1);
  });

  it('serializes a row with nullable columns null', () => {
    const result = serializeInsuredPerson({
      id: ID,
      contractId: ID,
      personId: ID,
      kvnr: null,
      tariffName: null,
      monthlyPremium: 100,
      selfRetention: 0,
      breStructure: null,
      includedBenefits: null,
      startDate: null,
      endDate: null,
      notes: null,
      createdAt: NOW,
    });
    expect(result.kvnr).toBeNull();
    expect(result.bre_structure).toBeNull();
  });

  it('maps a create payload to insert values', () => {
    const insert = toInsuredPersonInsert({
      contract_id: ID,
      person_id: ID,
      monthly_premium: 80,
    });
    expect(insert).toMatchObject({ contractId: ID, personId: ID, monthlyPremium: 80 });
    // self_retention omitted → undefined so the DB DEFAULT applies.
    expect(insert.selfRetention).toBeUndefined();
  });

  it('maps every field on a full update', () => {
    const update = toInsuredPersonUpdate({
      contract_id: ID,
      person_id: ID,
      kvnr: 'A1',
      tariff_name: 'Premium',
      monthly_premium: 500,
      self_retention: 300,
      bre_structure: null,
      included_benefits: {
        benefits: [{ category: 'zahnersatz', tiers: [{ up_to: null, pct: 80 }] }],
      },
      start_date: '2025-01-01',
      end_date: '2031-01-01',
      notes: 'n',
    });
    expect(Object.keys(update)).toHaveLength(11);
    expect(update.monthlyPremium).toBe(500);
  });

  it('produces an empty patch for an empty update', () => {
    expect(toInsuredPersonUpdate({})).toEqual({});
  });
});

describe('invoice mapping', () => {
  it('serializes a fully populated row', () => {
    const result = serializeInvoice({
      id: ID,
      insuredPersonId: ID,
      invoiceDate: '2026-06-01',
      invoiceNumber: 'R-1',
      providerName: 'Dr. Müller',
      providerType: 'arzt',
      totalAmount: 85,
      eligibleAmount: 62.5,
      selfPaidAmount: 0,
      status: 'neu',
      filePath: null,
      ocrRaw: null,
      notes: 'x',
      createdAt: NOW,
    });
    expect(result).toMatchObject({
      insured_person_id: ID,
      provider_name: 'Dr. Müller',
      eligible_amount: 62.5,
      status: 'neu',
    });
  });

  it('maps a create payload to insert values', () => {
    const insert = toInvoiceInsert({
      insured_person_id: ID,
      invoice_date: '2026-06-01',
      provider_name: 'Dr. Müller',
      total_amount: 85,
    });
    expect(insert).toMatchObject({ insuredPersonId: ID, totalAmount: 85 });
    expect(insert.status).toBeUndefined();
  });

  it('maps every field on a full update', () => {
    const update = toInvoiceUpdate({
      insured_person_id: ID,
      invoice_date: '2026-07-01',
      invoice_number: 'R-2',
      provider_name: 'Dr. B',
      provider_type: 'zahnarzt',
      total_amount: 100,
      status: 'geprüft',
      file_path: '/x',
      ocr_raw: 'raw',
      notes: 'n',
    });
    expect(Object.keys(update)).toHaveLength(10);
    expect(update.status).toBe('geprüft');
  });

  it('produces an empty patch for an empty update', () => {
    expect(toInvoiceUpdate({})).toEqual({});
  });
});

describe('position mapping', () => {
  it('serializes a row', () => {
    const result = serializePosition({
      id: ID,
      invoiceId: ID,
      goaeNumber: '0340',
      goaeCategory: 'GOÄ',
      description: 'Erörterung',
      multiplier: 2.3,
      baseAmount: 20.11,
      chargedAmount: 46.25,
      isValid: true,
      flagReason: null,
    });
    expect(result).toMatchObject({ goae_number: '0340', multiplier: 2.3, is_valid: true });
  });

  it('maps an input to insert values with the parent id', () => {
    const insert = toPositionInsert(ID, {
      goae_number: '0001',
      multiplier: 2.3,
      base_amount: 4.66,
      charged_amount: 10.72,
    });
    expect(insert).toMatchObject({ invoiceId: ID, goaeNumber: '0001', chargedAmount: 10.72 });
  });
});

describe('submission mapping', () => {
  it('serializes a row', () => {
    const result = serializeSubmission({
      id: ID,
      invoiceId: ID,
      submittedAt: NOW,
      submittedVia: 'email',
      expectedRefund: 62.5,
      refundDate: '2026-07-01',
    });
    expect(result).toMatchObject({
      invoice_id: ID,
      submitted_via: 'email',
      expected_refund: 62.5,
    });
  });

  it('maps an input to insert values', () => {
    const insert = toSubmissionInsert(ID, { submitted_via: 'post', expected_refund: 50 });
    expect(insert).toMatchObject({ invoiceId: ID, submittedVia: 'post', expectedRefund: 50 });
  });

  it('maps every field on a full update', () => {
    const update = toSubmissionUpdate({
      submitted_at: NOW,
      submitted_via: 'app',
      expected_refund: 50,
      refund_date: '2026-07-02',
    });
    expect(Object.keys(update)).toHaveLength(4);
    expect(update.submittedVia).toBe('app');
  });

  it('produces an empty patch for an empty update', () => {
    expect(toSubmissionUpdate({})).toEqual({});
  });
});
