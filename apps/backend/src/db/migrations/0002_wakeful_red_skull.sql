ALTER TABLE `invoice_positions` ADD `quantity` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_positions` ADD `treatment_date` text;