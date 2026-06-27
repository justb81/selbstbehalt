// SPDX-License-Identifier: Apache-2.0
//
// `/api/contracts` CRUD (§7.1, issue #11). Contracts are the central entity
// (Vollversicherung / Zusatztarif / Beihilfe) carrying the Selbstbehalt and the
// BRE structure. Payloads are validated against the shared Zod schemas; the
// `bre_structure` / `included_benefits` JSON columns round-trip via Drizzle.

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
import { serializeContract, toContractInsert, toContractUpdate } from '../lib/serialize.js';
import { parseJsonBody, parseQuery } from '../lib/validation.js';

const listQuerySchema = z.object({ person_id: uuid.optional() });

/** Look up a contract by id, or `undefined` if it does not exist. */
function findContract(db: Database, id: string) {
  return db.select().from(contracts).where(eq(contracts.id, id)).get();
}

/** Throw 400 if the referenced person does not exist (clearer than an FK 500). */
function assertPersonExists(db: Database, personId: string): void {
  const person = db.select({ id: persons.id }).from(persons).where(eq(persons.id, personId)).get();
  if (!person) {
    throw new HTTPException(400, { message: `Person ${personId} existiert nicht` });
  }
}

export function createContractsRoute(db: Database) {
  return new Hono()
    .get('/', (c) => {
      const { person_id } = parseQuery(c, listQuerySchema);
      const rows = db
        .select()
        .from(contracts)
        .where(person_id ? eq(contracts.personId, person_id) : undefined)
        .all();
      const body: Contract[] = rows.map(serializeContract);
      return c.json(body);
    })
    .post('/', async (c) => {
      const input = await parseJsonBody(c, contractCreateSchema);
      assertPersonExists(db, input.person_id);
      const row = db.insert(contracts).values(toContractInsert(input)).returning().get();
      return c.json(serializeContract(row), 201);
    })
    .get('/:id', (c) => {
      const row = findContract(db, c.req.param('id'));
      if (!row) throw new HTTPException(404, { message: 'Vertrag nicht gefunden' });
      return c.json(serializeContract(row));
    })
    .put('/:id', async (c) => {
      const id = c.req.param('id');
      if (!findContract(db, id))
        throw new HTTPException(404, { message: 'Vertrag nicht gefunden' });
      const input = await parseJsonBody(c, contractUpdateSchema);
      if (input.person_id !== undefined) assertPersonExists(db, input.person_id);

      const changes = toContractUpdate(input);
      const row =
        Object.keys(changes).length > 0
          ? db.update(contracts).set(changes).where(eq(contracts.id, id)).returning().get()
          : findContract(db, id)!;
      return c.json(serializeContract(row));
    })
    .delete('/:id', (c) => {
      const id = c.req.param('id');
      // Deleting a contract cascades to its invoices, positions, submissions and
      // BRE periods (FK ON DELETE CASCADE, §3.2) — the defined behaviour for
      // dependent records.
      const deleted = db.delete(contracts).where(eq(contracts.id, id)).returning().get();
      if (!deleted) throw new HTTPException(404, { message: 'Vertrag nicht gefunden' });
      return c.body(null, 204);
    });
}
