CREATE TABLE `bre_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`year` integer NOT NULL,
	`streak_months` integer DEFAULT 0 NOT NULL,
	`bre_amount` real DEFAULT 0 NOT NULL,
	`projected_bre` real,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`insurer_name` text NOT NULL,
	`contract_number` text,
	`tariff_name` text,
	`type` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`monthly_premium` real NOT NULL,
	`self_retention` real DEFAULT 0 NOT NULL,
	`bre_structure` text,
	`included_benefits` text,
	`notes` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `invoice_positions` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`goae_number` text NOT NULL,
	`goae_category` text,
	`description` text,
	`multiplier` real NOT NULL,
	`base_amount` real NOT NULL,
	`charged_amount` real NOT NULL,
	`is_valid` integer,
	`flag_reason` text,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`invoice_date` text NOT NULL,
	`invoice_number` text,
	`provider_name` text NOT NULL,
	`provider_type` text,
	`total_amount` real NOT NULL,
	`eligible_amount` real,
	`self_paid_amount` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'neu' NOT NULL,
	`decision` text,
	`file_path` text,
	`ocr_raw` text,
	`notes` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `persons` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`birth_date` text,
	`role` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`submitted_at` text,
	`submitted_via` text,
	`expected_refund` real,
	`actual_refund` real,
	`refund_date` text,
	`rejection_reason` text,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
