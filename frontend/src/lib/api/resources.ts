// SPDX-License-Identifier: Apache-2.0
//
// Typed resource methods over the fetch wrapper. One function per REST endpoint
// in docs/design.md §7.1, each parsing its response through the shared Zod
// schemas so callers get validated, fully-typed data.

import {
  contractSchema,
  invoiceSchema,
  submissionSchema,
  type Contract,
  type ContractCreate,
  type ContractUpdate,
  type Invoice,
  type InvoiceCreate,
  type InvoiceUpdate,
  type Submission,
  type SubmissionCreate,
  type SubmissionUpdate,
} from '@selbstbehalt/shared';
import { z } from 'zod';

import type { ApiRequester, QueryValue } from './client.js';

/** Shape returned by the backend `/api/health` probe. */
export const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.string(),
  db: z.enum(['up', 'down']),
});
export type Health = z.infer<typeof healthSchema>;

const contractListSchema = z.array(contractSchema);
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

  const invoices = {
    list: (filters?: Record<string, QueryValue>) =>
      request('/api/invoices', { query: filters, schema: invoiceListSchema }),
    get: (invoiceId: string) =>
      request(`/api/invoices/${id(invoiceId)}`, { schema: invoiceSchema }),
    create: (data: InvoiceCreate) =>
      request('/api/invoices', { method: 'POST', body: data, schema: invoiceSchema }),
    update: (invoiceId: string, data: InvoiceUpdate) =>
      request(`/api/invoices/${id(invoiceId)}`, {
        method: 'PUT',
        body: data,
        schema: invoiceSchema,
      }),
    remove: (invoiceId: string) => request(`/api/invoices/${id(invoiceId)}`, { method: 'DELETE' }),
    submit: (invoiceId: string, data: SubmissionCreate) =>
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

  return { health, contracts, invoices };
}

export type Resources = ReturnType<typeof createResources>;
export type { Contract, Invoice, Submission };
