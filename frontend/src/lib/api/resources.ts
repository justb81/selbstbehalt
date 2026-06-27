// SPDX-License-Identifier: Apache-2.0
//
// Typed resource methods over the fetch wrapper. One function per REST endpoint
// in docs/design.md §7.1, each parsing its response through the shared Zod
// schemas so callers get validated, fully-typed data.

import {
  contractSchema,
  healthBodySchema,
  insuredPersonSchema,
  invoiceSchema,
  invoiceWithPositionsSchema,
  submissionSchema,
  type Contract,
  type ContractCreate,
  type ContractUpdate,
  type HealthBody,
  type InsuredPerson,
  type InsuredPersonCreate,
  type InsuredPersonUpdate,
  type Invoice,
  type InvoiceCreatePayload,
  type InvoiceUpdate,
  type InvoiceWithPositions,
  type Submission,
  type SubmissionInput,
  type SubmissionUpdate,
} from '@selbstbehalt/shared';
import { z } from 'zod';

import type { ApiRequester, QueryValue } from './client.js';

/** Re-exported from `@selbstbehalt/shared` so callers keep a stable import. */
export const healthSchema = healthBodySchema;
export type Health = HealthBody;

/** Create payload for the nested endpoint — the contract comes from the path. */
export type InsuredPersonCreateBody = Omit<InsuredPersonCreate, 'contract_id'>;

const contractListSchema = z.array(contractSchema);
const insuredPersonListSchema = z.array(insuredPersonSchema);
const invoiceListSchema = z.array(invoiceSchema);

const id = (value: string): string => encodeURIComponent(value);

/** Build the resource-method namespaces bound to a requester. */
export function createResources(request: ApiRequester) {
  const health = () => request('/api/health', { schema: healthSchema });

  const contracts = {
    list: () => request('/api/contracts', { schema: contractListSchema }),
    get: (contractId: string) =>
      request(`/api/contracts/${id(contractId)}`, { schema: contractSchema }),
    create: (data: ContractCreate) =>
      request('/api/contracts', { method: 'POST', body: data, schema: contractSchema }),
    update: (contractId: string, data: ContractUpdate) =>
      request(`/api/contracts/${id(contractId)}`, {
        method: 'PUT',
        body: data,
        schema: contractSchema,
      }),
    remove: (contractId: string) =>
      request(`/api/contracts/${id(contractId)}`, { method: 'DELETE' }),
  };

  const insured = {
    list: (contractId: string) =>
      request(`/api/contracts/${id(contractId)}/insured`, { schema: insuredPersonListSchema }),
    create: (contractId: string, data: InsuredPersonCreateBody) =>
      request(`/api/contracts/${id(contractId)}/insured`, {
        method: 'POST',
        body: data,
        schema: insuredPersonSchema,
      }),
    get: (insuredId: string) =>
      request(`/api/insured/${id(insuredId)}`, { schema: insuredPersonSchema }),
    update: (insuredId: string, data: InsuredPersonUpdate) =>
      request(`/api/insured/${id(insuredId)}`, {
        method: 'PUT',
        body: data,
        schema: insuredPersonSchema,
      }),
    remove: (insuredId: string) => request(`/api/insured/${id(insuredId)}`, { method: 'DELETE' }),
  };

  const invoices = {
    list: (filters?: Record<string, QueryValue>) =>
      request('/api/invoices', { query: filters, schema: invoiceListSchema }),
    get: (invoiceId: string) =>
      request(`/api/invoices/${id(invoiceId)}`, { schema: invoiceWithPositionsSchema }),
    create: (data: InvoiceCreatePayload) =>
      request('/api/invoices', { method: 'POST', body: data, schema: invoiceWithPositionsSchema }),
    update: (invoiceId: string, data: InvoiceUpdate) =>
      request(`/api/invoices/${id(invoiceId)}`, {
        method: 'PUT',
        body: data,
        schema: invoiceWithPositionsSchema,
      }),
    remove: (invoiceId: string) => request(`/api/invoices/${id(invoiceId)}`, { method: 'DELETE' }),
    submit: (invoiceId: string, data: SubmissionInput) =>
      request(`/api/invoices/${id(invoiceId)}/submit`, {
        method: 'POST',
        body: data,
        schema: submissionSchema,
      }),
    refund: (invoiceId: string, data: SubmissionUpdate) =>
      request(`/api/invoices/${id(invoiceId)}/refund`, {
        method: 'PUT',
        body: data,
        schema: submissionSchema,
      }),
  };

  return { health, contracts, insured, invoices };
}

export type Resources = ReturnType<typeof createResources>;
export type { Contract, InsuredPerson, Invoice, InvoiceWithPositions, Submission };
