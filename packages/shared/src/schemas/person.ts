// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

import { auditFields, isoDate } from '../common.js';

/**
 * Payload for creating a person. `id`/`created_at` are assigned server-side.
 *
 * A person carries no role of its own — whether it is the Versicherungsnehmer
 * and/or a versicherte Person follows from `contracts.policyholder_id` and
 * `insured_persons.person_id` (§3.2).
 */
export const personCreateSchema = z.object({
  name: z.string().min(1, 'Name darf nicht leer sein'),
  birth_date: isoDate.nullish(),
});

/** A persisted person as returned by the API (§3.2 `persons`). */
export const personSchema = personCreateSchema.extend(auditFields);

/** Partial update — every field optional, server fields untouchable. */
export const personUpdateSchema = personCreateSchema.partial();

export type PersonCreate = z.infer<typeof personCreateSchema>;
export type Person = z.infer<typeof personSchema>;
export type PersonUpdate = z.infer<typeof personUpdateSchema>;
