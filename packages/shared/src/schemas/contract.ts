// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

import { auditFields, isoDate, uuid } from '../common.js';
import { contractTypeSchema } from '../enums.js';

/**
 * A Hauptvertrag (Versicherungsschein): insurer, contract number and the
 * Versicherungsnehmer (`policyholder_id`). The tariff-specific values — tariff,
 * premium, Selbstbehalt, BRE structure, benefits — live per versicherte Person
 * in `insured_persons` (§3.2), so they are not part of the contract itself.
 */
export const contractCreateSchema = z
  .object({
    policyholder_id: uuid,
    insurer_name: z.string().min(1, 'Versicherername darf nicht leer sein'),
    contract_number: z.string().nullish(),
    type: contractTypeSchema,
    start_date: isoDate,
    end_date: isoDate.nullish(),
    notes: z.string().nullish(),
  })
  .strict();

export const contractSchema = contractCreateSchema.extend(auditFields);

export const contractUpdateSchema = contractCreateSchema.partial();

export type ContractCreate = z.infer<typeof contractCreateSchema>;
export type Contract = z.infer<typeof contractSchema>;
export type ContractUpdate = z.infer<typeof contractUpdateSchema>;
