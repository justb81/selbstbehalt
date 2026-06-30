-- Migration 0005: §10 GOÄ Auslagenersatz (Porto/Versandkosten) als Positions-Kategorie
ALTER TABLE `invoice_positions` ADD `position_category` text DEFAULT 'leistung' NOT NULL;
