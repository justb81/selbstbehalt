-- Migration 0004: Günstigerprüfung Redesign (Issue #139)
-- Positions as source of truth; status workflow neu↔geprüft→bezahlt→eingereicht→erstattet.
-- 1. Add eligible_amount and refund_amount to invoice_positions
ALTER TABLE `invoice_positions` ADD `eligible_amount` real;
--> statement-breakpoint
ALTER TABLE `invoice_positions` ADD `refund_amount` real;
--> statement-breakpoint
-- 2. Backfill treatment_date from parent invoice where NULL
UPDATE `invoice_positions`
SET `treatment_date` = (
    SELECT `invoice_date`
    FROM `invoices`
    WHERE `invoices`.`id` = `invoice_positions`.`invoice_id`
)
WHERE `treatment_date` IS NULL;
--> statement-breakpoint
-- 3. Distribute invoice.eligible_amount proportionally to positions by charged_amount
UPDATE `invoice_positions`
SET `eligible_amount` = (
    SELECT
        CASE
            WHEN totals.`total_charged` > 0 THEN
                ROUND(inv.`eligible_amount` * `invoice_positions`.`charged_amount` / totals.`total_charged`, 2)
            ELSE 0
        END
    FROM `invoices` AS inv
    JOIN (
        SELECT `invoice_id`, SUM(`charged_amount`) AS `total_charged`
        FROM `invoice_positions` AS ip2
        GROUP BY `invoice_id`
    ) AS totals ON totals.`invoice_id` = inv.`id`
    WHERE inv.`id` = `invoice_positions`.`invoice_id`
      AND inv.`eligible_amount` IS NOT NULL
)
WHERE `invoice_id` IN (
    SELECT `id` FROM `invoices` WHERE `eligible_amount` IS NOT NULL
);
--> statement-breakpoint
-- 4. For abgelehnt invoices: set refund_amount = 0 (Ablehnung = Null-Erstattung)
UPDATE `invoice_positions`
SET `refund_amount` = 0
WHERE `invoice_id` IN (
    SELECT `id` FROM `invoices` WHERE `status` = 'abgelehnt'
);
--> statement-breakpoint
-- 5. Distribute actual_refund from latest submission to positions for erstattet invoices
UPDATE `invoice_positions`
SET `refund_amount` = (
    SELECT
        CASE
            WHEN totals.`total_charged` > 0 THEN
                ROUND(sub.`actual_refund` * `invoice_positions`.`charged_amount` / totals.`total_charged`, 2)
            ELSE 0
        END
    FROM `submissions` AS sub
    JOIN `invoices` AS inv ON inv.`id` = sub.`invoice_id`
    JOIN (
        SELECT `invoice_id`, SUM(`charged_amount`) AS `total_charged`
        FROM `invoice_positions` AS ip3
        GROUP BY `invoice_id`
    ) AS totals ON totals.`invoice_id` = inv.`id`
    WHERE inv.`id` = `invoice_positions`.`invoice_id`
      AND inv.`status` = 'erstattet'
      AND sub.`actual_refund` IS NOT NULL
      AND sub.`id` = (
          SELECT `id` FROM `submissions` AS s2
          WHERE s2.`invoice_id` = inv.`id`
          ORDER BY `submitted_at` DESC
          LIMIT 1
      )
)
WHERE `invoice_id` IN (
    SELECT inv2.`id`
    FROM `invoices` AS inv2
    JOIN `submissions` AS sub2 ON sub2.`invoice_id` = inv2.`id`
    WHERE inv2.`status` = 'erstattet'
      AND sub2.`actual_refund` IS NOT NULL
)
AND `refund_amount` IS NULL;
--> statement-breakpoint
-- 6. Migrate status values: selbst_gezahlt → bezahlt, abgelehnt → erstattet
UPDATE `invoices` SET `status` = 'bezahlt'   WHERE `status` = 'selbst_gezahlt';
--> statement-breakpoint
UPDATE `invoices` SET `status` = 'erstattet' WHERE `status` = 'abgelehnt';
--> statement-breakpoint
-- 7. Create invoice_status_events table
CREATE TABLE `invoice_status_events` (
    `id` text PRIMARY KEY NOT NULL,
    `invoice_id` text NOT NULL,
    `status` text NOT NULL,
    `changed_at` text NOT NULL,
    `note` text,
    FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- 8. Insert initial status events for every existing invoice using current (migrated) status
INSERT INTO `invoice_status_events` (`id`, `invoice_id`, `status`, `changed_at`, `note`)
SELECT
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
    `id`,
    `status`,
    `created_at`,
    'Initialer Statuseintrag (Migration 0004)'
FROM `invoices`;
--> statement-breakpoint
-- 9. Drop decision column from invoices (SQLite >= 3.35.0)
ALTER TABLE `invoices` DROP COLUMN `decision`;
--> statement-breakpoint
-- 10. Drop actual_refund and rejection_reason from submissions
ALTER TABLE `submissions` DROP COLUMN `actual_refund`;
--> statement-breakpoint
ALTER TABLE `submissions` DROP COLUMN `rejection_reason`;
