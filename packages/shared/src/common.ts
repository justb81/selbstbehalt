// SPDX-License-Identifier: Apache-2.0
//
// Reusable primitive schemas (IDs, money, dates) used across every entity.
// Keeping them here guarantees that, e.g., every monetary field validates
// identically wherever it appears.

import { z } from 'zod';

/** Entity identifier — a UUID stored as TEXT (see §3.2). */
export const uuid = z.string().uuid({ message: 'Muss eine gültige UUID sein' });

/**
 * A monetary amount in EUR, stored as `REAL`. Must be finite and non-negative;
 * rounded to whole cents to avoid binary-float drift creeping into the DB.
 */
export const money = z
  .number({ invalid_type_error: 'Betrag muss eine Zahl sein' })
  .finite('Betrag muss endlich sein')
  .nonnegative('Betrag darf nicht negativ sein')
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, {
    message: 'Betrag darf maximal zwei Nachkommastellen haben',
  });

/** A calendar date without time, formatted `YYYY-MM-DD` (SQLite `DATE`). */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum muss im Format JJJJ-MM-TT vorliegen')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, 'Datum ist kein gültiger Kalendertag');

/** A timestamp formatted as an ISO-8601 datetime string (SQLite `DATETIME`). */
export const isoDateTime = z
  .string()
  .datetime({ offset: true, message: 'Zeitstempel muss ein gültiges ISO-8601-Datum sein' });

/**
 * Server-managed audit fields. Every persisted entity carries these; the
 * Create variants strip them (`id`/`created_at` are generated server-side).
 */
export const auditFields = {
  id: uuid,
  created_at: isoDateTime,
};
