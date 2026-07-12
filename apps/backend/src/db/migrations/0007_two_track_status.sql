-- Migration 0007: two independent lifecycle tracks, state derived from the event log (Issues #139/#142)
--
-- Replaces the single linear `invoices.status` (neu↔geprüft→bezahlt→eingereicht→erstattet) with
-- three independent tracks — review / payment / submission — whose current value is DERIVED from
-- `invoice_status_events` (latest event per track). Paying the doctor and submitting to the insurer
-- now run in parallel. This migration: adds `track` to the event log, synthesises the milestone
-- events implied by the old linear status, creates the `invoice_current_status` view, and drops the
-- denormalised `invoices.status` column.

-- 1. Add the track discriminator to the event log and backfill it from the (globally unique) status value.
ALTER TABLE `invoice_status_events` ADD COLUMN `track` TEXT NOT NULL DEFAULT 'review';
--> statement-breakpoint
UPDATE `invoice_status_events` SET `track` = 'payment' WHERE `status` = 'bezahlt';
--> statement-breakpoint
UPDATE `invoice_status_events` SET `track` = 'submission' WHERE `status` IN ('eingereicht', 'erstattet');
--> statement-breakpoint
-- (neu / geprüft keep the default 'review'.)

-- 2. Synthesise the milestone events implied by the old linear status so the derived per-track state
--    reproduces it. The old model forced geprüft→bezahlt→eingereicht→erstattet, so eingereicht/erstattet
--    imply geprüft + bezahlt. Only insert where that track has no event yet (invoices that progressed
--    through the app already carry the real transition events; invoices migrated at 0004 carry only one).
--    2a. review = geprüft for every invoice that had left 'neu'.
INSERT INTO `invoice_status_events` (`id`, `invoice_id`, `track`, `status`, `changed_at`, `note`)
SELECT
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
    i.`id`, 'review', 'geprüft', i.`created_at`, 'Backfill Zwei-Track-Migration (0007)'
FROM `invoices` i
WHERE i.`status` IN ('geprüft', 'bezahlt', 'eingereicht', 'erstattet')
  AND NOT EXISTS (
    SELECT 1 FROM `invoice_status_events` e
    WHERE e.`invoice_id` = i.`id` AND e.`track` = 'review' AND e.`status` = 'geprüft'
  );
--> statement-breakpoint
--    2b. payment = bezahlt for every invoice that was paid (or beyond).
INSERT INTO `invoice_status_events` (`id`, `invoice_id`, `track`, `status`, `changed_at`, `note`)
SELECT
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
    i.`id`, 'payment', 'bezahlt', i.`created_at`, 'Backfill Zwei-Track-Migration (0007)'
FROM `invoices` i
WHERE i.`status` IN ('bezahlt', 'eingereicht', 'erstattet')
  AND NOT EXISTS (
    SELECT 1 FROM `invoice_status_events` e
    WHERE e.`invoice_id` = i.`id` AND e.`track` = 'payment'
  );
--> statement-breakpoint
--    2c. submission = eingereicht where the invoice was submitted but not yet reimbursed.
INSERT INTO `invoice_status_events` (`id`, `invoice_id`, `track`, `status`, `changed_at`, `note`)
SELECT
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
    i.`id`, 'submission', 'eingereicht', i.`created_at`, 'Backfill Zwei-Track-Migration (0007)'
FROM `invoices` i
WHERE i.`status` = 'eingereicht'
  AND NOT EXISTS (
    SELECT 1 FROM `invoice_status_events` e
    WHERE e.`invoice_id` = i.`id` AND e.`track` = 'submission'
  );
--> statement-breakpoint
--    2d. submission = erstattet where the invoice was reimbursed.
INSERT INTO `invoice_status_events` (`id`, `invoice_id`, `track`, `status`, `changed_at`, `note`)
SELECT
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
    i.`id`, 'submission', 'erstattet', i.`created_at`, 'Backfill Zwei-Track-Migration (0007)'
FROM `invoices` i
WHERE i.`status` = 'erstattet'
  AND NOT EXISTS (
    SELECT 1 FROM `invoice_status_events` e
    WHERE e.`invoice_id` = i.`id` AND e.`track` = 'submission'
  );
--> statement-breakpoint

-- 3. Index for the latest-per-track derivation.
CREATE INDEX `invoice_status_events_invoice_track_idx`
    ON `invoice_status_events` (`invoice_id`, `track`, `changed_at`);
--> statement-breakpoint

-- 4. Derived current-status view: latest event per track, ground state as fallback.
CREATE VIEW `invoice_current_status` AS
SELECT
    i.`id` AS `invoice_id`,
    COALESCE((
        SELECT e.`status` FROM `invoice_status_events` e
        WHERE e.`invoice_id` = i.`id` AND e.`track` = 'review'
        ORDER BY e.`rowid` DESC LIMIT 1
    ), 'neu') AS `review`,
    COALESCE((
        SELECT e.`status` FROM `invoice_status_events` e
        WHERE e.`invoice_id` = i.`id` AND e.`track` = 'payment'
        ORDER BY e.`rowid` DESC LIMIT 1
    ), 'offen') AS `payment`,
    COALESCE((
        SELECT e.`status` FROM `invoice_status_events` e
        WHERE e.`invoice_id` = i.`id` AND e.`track` = 'submission'
        ORDER BY e.`rowid` DESC LIMIT 1
    ), 'nicht_eingereicht') AS `submission`,
    CASE
        WHEN (
            SELECT e.`status` FROM `invoice_status_events` e
            WHERE e.`invoice_id` = i.`id` AND e.`track` = 'payment'
            ORDER BY e.`rowid` DESC LIMIT 1
        ) = 'bezahlt'
        THEN (
            SELECT substr(e.`changed_at`, 1, 10) FROM `invoice_status_events` e
            WHERE e.`invoice_id` = i.`id` AND e.`track` = 'payment'
            ORDER BY e.`rowid` DESC LIMIT 1
        )
        ELSE NULL
    END AS `paid_on`
FROM `invoices` i;
--> statement-breakpoint

-- 5. Drop the denormalised status column (SQLite >= 3.35; the view references only invoices.id).
ALTER TABLE `invoices` DROP COLUMN `status`;
