// SPDX-License-Identifier: Apache-2.0
//
// `/api/persons` CRUD (§7.1, issue #35). Persons are the identity layer:
// a person may be Versicherungsnehmer on one or more contracts and/or a
// versicherte Person on one or more contracts. The person row itself carries
// only name and optional birth date; relationships live in `contracts` and
// `insured_persons`.

import { personCreateSchema, personUpdateSchema, type Person } from '@selbstbehalt/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

import type { Database } from '../db/client.js';
import { persons } from '../db/schema.js';
import { serializePerson, toPersonInsert, toPersonUpdate } from '../lib/serialize.js';
import { parseJsonBody } from '../lib/validation.js';

function findPerson(db: Database, id: string) {
  return db.select().from(persons).where(eq(persons.id, id)).get();
}

export function createPersonsRoute(db: Database) {
  return new Hono()
    .get('/', (c) => {
      const rows = db.select().from(persons).all();
      const body: Person[] = rows.map(serializePerson);
      return c.json(body);
    })
    .post('/', async (c) => {
      const input = await parseJsonBody(c, personCreateSchema);
      const row = db.insert(persons).values(toPersonInsert(input)).returning().get();
      return c.json(serializePerson(row), 201);
    })
    .get('/:id', (c) => {
      const row = findPerson(db, c.req.param('id'));
      if (!row) throw new HTTPException(404, { message: 'Person nicht gefunden' });
      return c.json(serializePerson(row));
    })
    .put('/:id', async (c) => {
      const id = c.req.param('id');
      if (!findPerson(db, id)) throw new HTTPException(404, { message: 'Person nicht gefunden' });
      const input = await parseJsonBody(c, personUpdateSchema);
      const changes = toPersonUpdate(input);
      const row =
        Object.keys(changes).length > 0
          ? db.update(persons).set(changes).where(eq(persons.id, id)).returning().get()
          : findPerson(db, id)!;
      return c.json(serializePerson(row));
    })
    .delete('/:id', (c) => {
      const id = c.req.param('id');
      // Cascade: contracts, insured_persons, invoices, positions, submissions,
      // and BRE periods for this person are all removed by FK ON DELETE CASCADE.
      const deleted = db.delete(persons).where(eq(persons.id, id)).returning().get();
      if (!deleted) throw new HTTPException(404, { message: 'Person nicht gefunden' });
      return c.body(null, 204);
    });
}
