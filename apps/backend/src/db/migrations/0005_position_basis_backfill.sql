-- Migration 0005: reconstruct base_amount for non-fee-schedule positions.
--
-- Before the non-fee-schedule model (#248), Auslagenersatz positions were persisted
-- with base_amount = 0 while charged_amount held the real amount (the old form forced
-- the Basis to 0). The #248 model requires charged_amount = quantity × base_amount
-- (Anzahl × Basis) for the non-fee-schedule categories (Auslagenersatz,
-- Arznei-/Hilfsmittel), so those legacy rows now violate the shared invoice-position
-- invariant and make the invoice unreadable on the client.
--
-- Reconstruct the per-unit Basis (Einzelpreis) = charged_amount / quantity for every
-- non-fee-schedule row that does not already satisfy the invariant. quantity is
-- NOT NULL DEFAULT 1, so the division is always safe. Re-runs converge to a stable value
-- rather than strictly skipping every touched row: GOÄ/GOZ/GOT rows and rows already at
-- Anzahl × Basis fall out of the WHERE, while an amount that is not evenly divisible (base
-- holds only 2 decimals — e.g. quantity 3, charged 10.00 → base 3.33, 3 × 3.33 = 9.99)
-- stays matched and is rewritten to the same 3.33 on every run, so the data never drifts.
-- The relaxed read schema (invoicePositionSchema) tolerates that residual inconsistency.
UPDATE `invoice_positions`
SET `base_amount` = ROUND(`charged_amount` / `quantity`, 2)
WHERE `goae_category` IN ('Auslagenersatz', 'Arznei-/Hilfsmittel')
  AND ROUND(`charged_amount`, 2) <> ROUND(`quantity` * `base_amount`, 2);
