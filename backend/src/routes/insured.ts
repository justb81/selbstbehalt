// SPDX-License-Identifier: Apache-2.0
//
// Versicherte-Personen endpoints (§7.1). A contract (Hauptvertrag) covers one or
// more insured persons, each with its own Krankenversichertennummer (KVNR),
// tariff, premium, Selbstbehalt and BRE structure. Listing and creation are
// nested under their contract; item operations live at `/api/insured/:id`.
//
//   GET    /api/contracts/:contractId/insured
//   POST   /api/contracts/:contractId/insured
//   GET    /api/insured/:id
//   PUT    /api/insured/:id
//   DELETE /api/insured/:id

import {
  insuredPersonCreateSchema,
  insuredPersonUpdateSchema,
  type InsuredPerson,
} from '@selbstbehalt/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

import type { Database } from '../db/client.js';
import { contracts, insuredPersons, persons } from '../db/schema.js';
import {
  serializeInsuredPerson,
  toInsuredPersonInsert,
  toInsuredPersonUpdate,
} from '../lib/serialize.js';
import { parseJsonBody } from '../lib/validation.js';

// The nested create takes its contract from the path, so the body omits it.
const nestedCreateSchema = insuredPersonCreateSchema.omit({ contract_id: true });

function findInsured(db: Database, id: string) {
  return db.select().from(insuredPersons).where(eq(insuredPersons.id, id)).get();
}

function assertContractExists(db: Database, contractId: string): void {
  const row = db
    .select({ id: contracts.id })
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .get();
  if (!row) throw new HTTPException(400, { message: `Vertrag ${contractId} existiert nicht` });
}

function assertPersonExists(db: Database, personId: string): void {
  const row = db.select({ id: persons.id }).from(persons).where(eq(persons.id, personId)).get();
  if (!row) throw new HTTPException(400, { message: `Person ${personId} existiert nicht` });
}

export function createInsuredRoute(db: Database) {
  return new Hono()
    .get('/contracts/:contractId/insured', (c) => {
      const contractId = c.req.param('contractId');
      assertContractExists(db, contractId);
      const rows = db
        .select()
        .from(insuredPersons)
        .where(eq(insuredPersons.contractId, contractId))
        .all();
      const body: InsuredPerson[] = rows.map(serializeInsuredPerson);
      return c.json(body);
    })
    .post('/contracts/:contractId/insured', async (c) => {
      const contractId = c.req.param('contractId');
      assertContractExists(db, contractId);
      const input = await parseJsonBody(c, nestedCreateSchema);
      assertPersonExists(db, input.person_id);
      const row = db
        .insert(insuredPersons)
        .values(toInsuredPersonInsert({ ...input, contract_id: contractId }))
        .returning()
        .get();
      return c.json(serializeInsuredPerson(row), 201);
    })
    .get('/insured/:id', (c) => {
      const row = findInsured(db, c.req.param('id'));
      if (!row) throw new HTTPException(404, { message: 'Versicherte Person nicht gefunden' });
      return c.json(serializeInsuredPerson(row));
    })
    .put('/insured/:id', async (c) => {
      const id = c.req.param('id');
      if (!findInsured(db, id))
        throw new HTTPException(404, { message: 'Versicherte Person nicht gefunden' });
      const input = await parseJsonBody(c, insuredPersonUpdateSchema);
      if (input.contract_id !== undefined) assertContractExists(db, input.contract_id);
      if (input.person_id !== undefined) assertPersonExists(db, input.person_id);

      const changes = toInsuredPersonUpdate(input);
      const row =
        Object.keys(changes).length > 0
          ? db
              .update(insuredPersons)
              .set(changes)
              .where(eq(insuredPersons.id, id))
              .returning()
              .get()
          : findInsured(db, id)!;
      return c.json(serializeInsuredPerson(row));
    })
    .delete('/insured/:id', (c) => {
      // Cascades to the insured person's invoices (and their positions and
      // submissions) and BRE periods (FK ON DELETE CASCADE, §3.2).
      const deleted = db
        .delete(insuredPersons)
        .where(eq(insuredPersons.id, c.req.param('id')))
        .returning()
        .get();
      if (!deleted) throw new HTTPException(404, { message: 'Versicherte Person nicht gefunden' });
      return c.body(null, 204);
    });
}
