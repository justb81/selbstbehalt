// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';

// The default `api` instance resolves its base URL via the settings store, which
// reads SvelteKit's $env/dynamic/public — stub it so the import graph loads.
vi.mock('$env/dynamic/public', () => ({ env: {} }));

import { createApi } from './index';
import type { ApiRequester } from './client';
import { createResources } from './resources';

const UUID = '3f9a8c2e-1d4b-4c6a-9e2f-7b1c0d5e6a7f';

/** A requester stub that records calls and returns a canned value. */
function stubRequester() {
  const calls: Array<{ path: string; opts: Record<string, unknown> }> = [];
  const request = vi.fn(async (path: string, opts: Record<string, unknown> = {}) => {
    calls.push({ path, opts });
    return undefined;
  }) as unknown as ApiRequester;
  return { request, calls };
}

describe('createResources', () => {
  it('maps contract methods to the §7.1 endpoints with the right verbs', async () => {
    const { request, calls } = stubRequester();
    const { contracts } = createResources(request);

    await contracts.list();
    await contracts.get(UUID);
    await contracts.create({
      policyholder_id: UUID,
      insurer_name: 'DKV',
      type: 'vollversicherung',
      start_date: '2024-01-01',
    });
    await contracts.update(UUID, { contract_number: 'KV-460' });
    await contracts.remove(UUID);

    expect(calls[0]!).toMatchObject({ path: '/api/contracts' });
    expect(calls[0]!.opts.schema).toBeDefined();
    expect(calls[1]!).toMatchObject({ path: `/api/contracts/${UUID}` });
    expect(calls[2]!.opts).toMatchObject({ method: 'POST' });
    expect(calls[3]!.opts).toMatchObject({ method: 'PUT' });
    expect(calls[4]!.opts).toMatchObject({ method: 'DELETE' });
  });

  it('maps invoice methods including submit and refund', async () => {
    const { request, calls } = stubRequester();
    const { invoices } = createResources(request);

    await invoices.list({ status: 'neu' });
    await invoices.get(UUID);
    // No body-level invoice_id — it comes from the path, symmetric with refund.
    await invoices.submit(UUID, { submitted_via: 'email' });
    await invoices.refund(UUID, { positions: [{ id: UUID, refund_amount: 62.5 }] });

    expect(calls[0]!.opts.query).toEqual({ status: 'neu' });
    expect(calls[1]!.path).toBe(`/api/invoices/${UUID}`);
    expect(calls[2]!).toMatchObject({ path: `/api/invoices/${UUID}/submit` });
    expect(calls[2]!.opts).toMatchObject({ method: 'POST' });
    expect(calls[3]!).toMatchObject({ path: `/api/invoices/${UUID}/refund` });
    expect(calls[3]!.opts).toMatchObject({ method: 'PUT' });
  });

  it('maps invoice update and remove to the correct endpoints', async () => {
    const { request, calls } = stubRequester();
    const { invoices } = createResources(request);

    await invoices.update(UUID, { provider_name: 'Dr. Test' });
    await invoices.remove(UUID);

    expect(calls[0]!).toMatchObject({ path: `/api/invoices/${UUID}` });
    expect(calls[0]!.opts).toMatchObject({ method: 'PUT' });
    expect(calls[1]!).toMatchObject({ path: `/api/invoices/${UUID}` });
    expect(calls[1]!.opts).toMatchObject({ method: 'DELETE' });
  });

  it('maps stats endpoints for year and BRE history', async () => {
    const { request, calls } = stubRequester();
    const { stats } = createResources(request);

    await stats.year(2025);
    await stats.bre(UUID);

    expect(calls[0]!.path).toBe('/api/stats/year/2025');
    expect(calls[1]!.path).toBe(`/api/stats/bre/${UUID}`);
  });

  it('maps the positions/reductions/validations roll-up endpoints (#239)', async () => {
    const { request, calls } = stubRequester();
    const { stats } = createResources(request);

    await stats.positions(UUID);
    await stats.reductions('tariff');
    await stats.validations();

    expect(calls[0]!.path).toBe(`/api/stats/positions/${UUID}`);
    expect(calls[1]!).toMatchObject({ path: '/api/stats/reductions' });
    expect(calls[1]!.opts.query).toEqual({ group_by: 'tariff' });
    expect(calls[2]!.path).toBe('/api/stats/validations');
  });

  it('maps insured-person methods to the nested and item endpoints', async () => {
    const { request, calls } = stubRequester();
    const { insured } = createResources(request);

    await insured.list(UUID);
    await insured.create(UUID, { person_id: UUID, monthly_premium: 450 });
    await insured.get(UUID);
    await insured.update(UUID, { monthly_premium: 460 });
    await insured.remove(UUID);

    expect(calls[0]!).toMatchObject({ path: `/api/contracts/${UUID}/insured` });
    expect(calls[1]!).toMatchObject({ path: `/api/contracts/${UUID}/insured` });
    expect(calls[1]!.opts).toMatchObject({ method: 'POST' });
    expect(calls[2]!).toMatchObject({ path: `/api/insured/${UUID}` });
    expect(calls[3]!.opts).toMatchObject({ method: 'PUT' });
    expect(calls[4]!.opts).toMatchObject({ method: 'DELETE' });
  });

  it('percent-encodes path identifiers', async () => {
    const { request, calls } = stubRequester();
    const { contracts } = createResources(request);

    await contracts.get('a/b');

    expect(calls[0]!.path).toBe('/api/contracts/a%2Fb');
  });
});

describe('createApi (full client)', () => {
  function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  it('parses a contract response through the shared schema', async () => {
    const contract = {
      id: UUID,
      created_at: '2026-01-01T00:00:00Z',
      policyholder_id: UUID,
      insurer_name: 'DKV',
      type: 'vollversicherung',
      start_date: '2024-01-01',
    };
    const fetch = vi.fn().mockResolvedValue(jsonResponse(contract));
    const api = createApi({ baseUrl: 'http://api.test', fetch });

    const result = await api.contracts.get(UUID);

    expect(result.insurer_name).toBe('DKV');
    expect(fetch.mock.calls[0]![0]).toBe(`http://api.test/api/contracts/${UUID}`);
  });

  it('parses the health probe response', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ status: 'ok', service: 'selbstbehalt-backend', db: 'up' }));
    const api = createApi({ baseUrl: 'http://api.test', fetch });

    await expect(api.health()).resolves.toMatchObject({ status: 'ok', db: 'up' });
  });
});
