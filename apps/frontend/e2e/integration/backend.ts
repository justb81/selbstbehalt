// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
//
// Integration profile (issue #378): the plumbing that runs the E2E suite against
// a **real** backend instead of `page.route()` mocks.
//
// Why a per-worker backend process rather than a single one in `webServer`:
// Playwright's `webServer` is global, so one shared backend would mean one shared
// SQLite database across all workers — and the list/roll-up pages (`/`, `/invoices`,
// `/stats`) aggregate over *everything* in it, so two parallel scenarios would see
// each other's data. Spawning one backend per worker keeps `fullyParallel` and the
// "no shared state" property the mocked specs already have, at the cost of a
// process per worker. Each one runs against `DATABASE_PATH=:memory:` with the real
// checked-in Drizzle migrations, so there is nothing to clean up on disk.
//
// The browser is pointed at that backend through the app's own runtime setting
// (`settings.apiUrl`, localStorage — the documented separate-origin deployment of
// §7.2), not through the Vite proxy, which can only ever target one fixed port.

import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import { test as base, type APIRequestContext, type APIResponse } from '@playwright/test';
import type {
  Contract,
  ContractCreate,
  InsuredPerson,
  InsuredPersonCreate,
  InvoiceCreatePayload,
  InvoiceWithPositions,
  Person,
  PersonCreate,
  SubmissionInput,
} from '@selbstbehalt/shared';

/** `apps/backend`, resolved from this file so the cwd never matters. */
const BACKEND_DIR = fileURLToPath(new URL('../../../backend', import.meta.url));
const TSX_BIN = fileURLToPath(new URL('../../../backend/node_modules/.bin/tsx', import.meta.url));

/** The localStorage key the settings store persists to (`$lib/stores/settings`). */
const SETTINGS_STORAGE_KEY = 'selbstbehalt:settings';

const STARTUP_TIMEOUT_MS = 60_000;

/** A backend process owned by one Playwright worker. */
export interface Backend {
  /** Origin the backend listens on, e.g. `http://127.0.0.1:39481`. */
  baseUrl: string;
}

/**
 * Ask the OS for an unused port by binding to port 0 and releasing it again.
 * The backend's config schema rejects `PORT=0`, so the port has to be known
 * before the process starts.
 */
async function reserveFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/** Poll `/api/health` until the freshly spawned server answers, or give up. */
async function waitForHealth(baseUrl: string, child: ChildProcess, log: () => string) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(
        `Backend exited with code ${child.exitCode} before becoming healthy:\n${log()}`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet — keep polling.
    }
    if (Date.now() > deadline) {
      throw new Error(`Backend did not become healthy within ${STARTUP_TIMEOUT_MS} ms:\n${log()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Start one backend process against an in-memory database. */
async function startBackend(): Promise<{ backend: Backend; stop: () => Promise<void> }> {
  const port = await reserveFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const child = spawn(TSX_BIN, ['src/index.ts'], {
    cwd: BACKEND_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      // Ephemeral per process: perfect isolation, nothing to clean up.
      DATABASE_PATH: ':memory:',
      NODE_ENV: 'test',
      // No API key and no CORS allow-list: the browser talks to this origin
      // cross-origin, exactly like the documented separate-backend setup (§7.2).
      API_KEY: '',
      CORS_ORIGINS: '*',
    },
  });

  // Drain both streams (an unread pipe would eventually block the child) and
  // keep a tail of the output so a startup failure is diagnosable.
  const output: string[] = [];
  const capture = (chunk: Buffer) => {
    output.push(chunk.toString());
    if (output.length > 50) output.splice(0, output.length - 50);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);

  await waitForHealth(baseUrl, child, () => output.join(''));

  const stop = async (): Promise<void> => {
    if (child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const kill = setTimeout(() => child.kill('SIGKILL'), 5_000);
      child.once('exit', () => {
        clearTimeout(kill);
        resolve();
      });
      child.kill('SIGTERM');
    });
  };

  return { backend: { baseUrl }, stop };
}

/** Throw with the server's own error body instead of a bare status code. */
async function expectOk(response: APIResponse): Promise<unknown> {
  if (!response.ok()) {
    throw new Error(`${response.url()} → ${response.status()}: ${await response.text()}`);
  }
  return response.status() === 204 ? undefined : ((await response.json()) as unknown);
}

/**
 * Wipe every row by deleting the persons: `contracts`, `insured_persons`,
 * `invoices`, positions, status events, submissions and BRE periods all cascade
 * from there (`onDelete: 'cascade'` throughout the schema).
 */
async function resetDatabase(request: APIRequestContext): Promise<void> {
  const persons = (await expectOk(await request.get('/api/persons'))) as Person[];
  for (const person of persons) {
    await expectOk(await request.delete(`/api/persons/${person.id}`));
  }
}

/**
 * Thin, typed wrapper over the real REST API used to build scenarios. Seeding
 * through the API (rather than by writing SQL) means the preconditions
 * themselves already exercise the server-side Zod validation and the
 * status-event log.
 */
export interface SeedApi {
  /** The raw request context, bound to the worker's backend. */
  readonly request: APIRequestContext;
  createPerson(input: PersonCreate): Promise<Person>;
  createContract(input: ContractCreate): Promise<Contract>;
  createInsured(
    contractId: string,
    input: Omit<InsuredPersonCreate, 'contract_id'>,
  ): Promise<InsuredPerson>;
  createInvoice(input: InvoiceCreatePayload): Promise<InvoiceWithPositions>;
  getInvoice(id: string): Promise<InvoiceWithPositions>;
  /** `review: neu → geprüft` — the precondition for both other tracks. */
  markReviewed(id: string, note?: string): Promise<void>;
  /** `payment: offen → bezahlt`; `paidOn` becomes the Zahlungsdatum. */
  markPaid(id: string, paidOn?: string): Promise<void>;
  /** `submission: nicht_eingereicht → eingereicht`. */
  submit(id: string, input?: SubmissionInput): Promise<void>;
  /** `submission: eingereicht → erstattet`, writing the per-position refunds. */
  recordRefund(
    id: string,
    positions: { id: string; refund_amount: number }[],
    refundDate?: string,
  ): Promise<void>;
}

function createSeedApi(request: APIRequestContext): SeedApi {
  return {
    request,
    async createPerson(input) {
      return (await expectOk(await request.post('/api/persons', { data: input }))) as Person;
    },
    async createContract(input) {
      return (await expectOk(await request.post('/api/contracts', { data: input }))) as Contract;
    },
    async createInsured(contractId, input) {
      return (await expectOk(
        await request.post(`/api/contracts/${contractId}/insured`, { data: input }),
      )) as InsuredPerson;
    },
    async createInvoice(input) {
      return (await expectOk(
        await request.post('/api/invoices', { data: input }),
      )) as InvoiceWithPositions;
    },
    async getInvoice(id) {
      return (await expectOk(await request.get(`/api/invoices/${id}`))) as InvoiceWithPositions;
    },
    async markReviewed(id, note) {
      await expectOk(
        await request.post(`/api/invoices/${id}/review`, { data: { status: 'geprüft', note } }),
      );
    },
    async markPaid(id, paidOn) {
      await expectOk(
        await request.post(`/api/invoices/${id}/payment`, {
          data: { status: 'bezahlt', paid_on: paidOn },
        }),
      );
    },
    async submit(id, input = {}) {
      await expectOk(await request.post(`/api/invoices/${id}/submit`, { data: input }));
    },
    async recordRefund(id, positions, refundDate) {
      await expectOk(
        await request.put(`/api/invoices/${id}/refund`, {
          data: { positions, refund_date: refundDate },
        }),
      );
    },
  };
}

interface IntegrationWorkerFixtures {
  backend: Backend;
}

interface IntegrationTestFixtures {
  seed: SeedApi;
}

/**
 * `test` for the integration profile. Every test gets an empty database and a
 * `seed` handle; `page` is pre-wired to the worker's backend.
 */
export const test = base.extend<IntegrationTestFixtures, IntegrationWorkerFixtures>({
  backend: [
    // eslint-disable-next-line no-empty-pattern -- Playwright's fixture signature
    async ({}, use) => {
      const { backend, stop } = await startBackend();
      await use(backend);
      await stop();
    },
    { scope: 'worker' },
  ],

  // `auto` so every test in this project starts from an empty database, whether
  // or not it seeds a scenario itself.
  seed: [
    async ({ backend, playwright }, use) => {
      const request = await playwright.request.newContext({ baseURL: backend.baseUrl });
      await resetDatabase(request);
      await use(createSeedApi(request));
      await request.dispose();
    },
    { auto: true },
  ],

  page: async ({ page, backend }, use) => {
    // Runs before any app script, so the settings store hydrates with the
    // worker's backend already selected and the very first request goes there.
    await page.addInitScript(
      ([key, apiUrl]) => {
        localStorage.setItem(key, JSON.stringify({ apiUrl }));
      },
      [SETTINGS_STORAGE_KEY, backend.baseUrl] as const,
    );
    await use(page);
  },
});

export { expect } from '@playwright/test';
