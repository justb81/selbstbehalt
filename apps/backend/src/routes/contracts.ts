// SPDX-License-Identifier: Apache-2.0
//
// `/api/contracts` CRUD (§7.1, issue #11). A contract is the Hauptvertrag
// (Vollversicherung / Zusatztarif / Beihilfe): insurer, contract number and the
// Versicherungsnehmer (`policyholder_id`). The tariff-specific cover — tariff,
// Selbstbehalt, BRE structure, benefits — lives per versicherte Person in
// `/api/contracts/:id/insured` (see `insured.ts`). Payloads are validated
// against the shared Zod schemas.

import {
  contractCreateSchema,
  contractUpdateSchema,
  uuid,
  type Contract,
} from '@selbstbehalt/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import type { Database } from '../db/client.js';
import { contracts, persons } from '../db/schema.js';
import { assertFkExists, requireRow, updateOrReturn } from '../lib/db-helpers.js';
import { serializeContract, toContractInsert, toContractUpdate } from '../lib/serialize.js';
import { parseJsonBody, parseQuery } from '../lib/validation.js';

const listQuerySchema = z.object({ policyholder_id: uuid.optional() });

/** Look up a contract by id, or `undefined` if it does not exist. */
function findContract(db: Database, id: string) {
  return db.select().from(contracts).where(eq(contracts.id, id)).get();
}

export function createContractsRoute(db: Database) {
  return new Hono()
    .get('/', (c) => {
      const { policyholder_id } = parseQuery(c, listQuerySchema);
      const rows = db
        .select()
        .from(contracts)
        .where(policyholder_id ? eq(contracts.policyholderId, policyholder_id) : undefined)
        .all();
      const body: Contract[] = rows.map(serializeContract);
      return c.json(body);
    })
    .post('/', async (c) => {
      const input = await parseJsonBody(c, contractCreateSchema);
      assertFkExists(
        db,
        persons,
        input.policyholder_id,
        `Person ${input.policyholder_id} existiert nicht`,
      );
      const row = db.insert(contracts).values(toContractInsert(input)).returning().get();
      return c.json(serializeContract(row), 201);
    })
    .get('/:id', (c) => {
      const row = requireRow(() => findContract(db, c.req.param('id')), 'Vertrag nicht gefunden');
      return c.json(serializeContract(row));
    })
    .put('/:id', async (c) => {
      const id = c.req.param('id');
      const existing = requireRow(() => findContract(db, id), 'Vertrag nicht gefunden');
      const input = await parseJsonBody(c, contractUpdateSchema);
      if (input.policyholder_id !== undefined)
        assertFkExists(
          db,
          persons,
          input.policyholder_id,
          `Person ${input.policyholder_id} existiert nicht`,
        );

      const changes = toContractUpdate(input);
      const row = updateOrReturn(
        changes,
        () => db.update(contracts).set(changes).where(eq(contracts.id, id)).returning().get()!,
        existing,
      );
      return c.json(serializeContract(row));
    })
    .delete('/:id', (c) => {
      const id = c.req.param('id');
      // Deleting a contract cascades to its insured persons and, through them,
      // to their invoices, positions, submissions and BRE periods (FK ON DELETE
      // CASCADE, §3.2) — the defined behaviour for dependent records.
      const deleted = db.delete(contracts).where(eq(contracts.id, id)).returning().get();
      if (!deleted) throw new HTTPException(404, { message: 'Vertrag nicht gefunden' });
      return c.body(null, 204);
    });
}
