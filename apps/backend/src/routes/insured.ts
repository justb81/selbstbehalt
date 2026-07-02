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
import { and, eq, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

import type { Database } from '../db/client.js';
import { contracts, insuredPersons, persons } from '../db/schema.js';
import { assertFkExists, requireRow, updateOrReturn } from '../lib/db-helpers.js';
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

// A person may be insured only once per contract (unique index on
// (contract_id, person_id), §3.2). Reject a colliding pair with a clear 409
// instead of letting the DB raise an opaque constraint error. `exceptId` skips
// the row being updated so a no-op PUT does not collide with itself.
function assertNoDuplicateInsured(
  db: Database,
  contractId: string,
  personId: string,
  exceptId?: string,
): void {
  const where = and(
    eq(insuredPersons.contractId, contractId),
    eq(insuredPersons.personId, personId),
    ...(exceptId ? [ne(insuredPersons.id, exceptId)] : []),
  );
  const row = db.select({ id: insuredPersons.id }).from(insuredPersons).where(where).get();
  if (row) {
    throw new HTTPException(409, {
      message: `Person ${personId} ist auf Vertrag ${contractId} bereits versichert`,
    });
  }
}

export function createInsuredRoute(db: Database) {
  return new Hono()
    .get('/contracts/:contractId/insured', (c) => {
      const contractId = c.req.param('contractId');
      assertFkExists(db, contracts, contractId, `Vertrag ${contractId} existiert nicht`);
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
      assertFkExists(db, contracts, contractId, `Vertrag ${contractId} existiert nicht`);
      const input = await parseJsonBody(c, nestedCreateSchema);
      assertFkExists(db, persons, input.person_id, `Person ${input.person_id} existiert nicht`);
      assertNoDuplicateInsured(db, contractId, input.person_id);
      const row = db
        .insert(insuredPersons)
        .values(toInsuredPersonInsert({ ...input, contract_id: contractId }))
        .returning()
        .get();
      return c.json(serializeInsuredPerson(row), 201);
    })
    .get('/insured/:id', (c) => {
      const row = requireRow(
        () => findInsured(db, c.req.param('id')),
        'Versicherte Person nicht gefunden',
      );
      return c.json(serializeInsuredPerson(row));
    })
    .put('/insured/:id', async (c) => {
      const id = c.req.param('id');
      const existing = requireRow(() => findInsured(db, id), 'Versicherte Person nicht gefunden');
      const input = await parseJsonBody(c, insuredPersonUpdateSchema);
      if (input.contract_id !== undefined)
        assertFkExists(
          db,
          contracts,
          input.contract_id,
          `Vertrag ${input.contract_id} existiert nicht`,
        );
      if (input.person_id !== undefined)
        assertFkExists(db, persons, input.person_id, `Person ${input.person_id} existiert nicht`);
      // Re-pointing the row at another contract/person must not collide with an
      // existing (contract, person) pair.
      if (input.contract_id !== undefined || input.person_id !== undefined) {
        assertNoDuplicateInsured(
          db,
          input.contract_id ?? existing.contractId,
          input.person_id ?? existing.personId,
          id,
        );
      }

      const changes = toInsuredPersonUpdate(input);
      const row = updateOrReturn(
        changes,
        () =>
          db
            .update(insuredPersons)
            .set(changes)
            .where(eq(insuredPersons.id, id))
            .returning()
            .get()!,
        existing,
      );
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
