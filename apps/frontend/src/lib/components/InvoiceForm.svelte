<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Shared invoice form used by both the create page (/invoices/new) and the edit
  page (/invoices/[id]/edit). It is a thin wrapper (issue #169) around
  @selbstbehalt/medic-invoice-check's <InvoiceReview>, which owns the OCR scan
  section, the Rechnungskopf and the GOÄ/GOZ position table with §5
  hints/warnings. This wrapper adds only what is tariff-/backend-specific:
    - versicherte Person selection,
    - Notizen,
    - the per-position reimbursement (`eligible_amount`) via erstattungs-engine,
      plus the summary line that explains a reduced or zero result before saving,
    - the OCR opt-out (raw OCR saved by default), and
    - assembling + saving the payload.
  Mode-specific: create shows the scanner + OCR opt-out; edit pre-fills from
  initialData and offers "Positionen neu einlesen" when ocr_raw is stored.
-->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import {
    BENEFIT_CATEGORY_LABELS,
    formatEur,
    isNonScheduleCategory,
    roundCents,
    type BenefitCategory,
    type InvoicePositionInput,
    type InvoiceWithPositions,
    type InsuredPerson,
    type ProviderType,
  } from '@selbstbehalt/shared';
  import {
    InvoiceReview,
    type ReviewPositionRow,
    type ScanResult,
  } from '@selbstbehalt/medic-invoice-check';
  import { settings } from '$lib/stores/settings';
  import { computeErstattung, type ErstattungPosition } from '$lib/utils/erstattungs-engine';
  import { type AuslagenDerivationPosition } from '$lib/utils/auslagen-benefit-category';
  import { resolveBenefitCategory } from '$lib/utils/benefit-category';
  import { Button } from '$lib/components/ui/button';
  import { Label } from '$lib/components/ui/label';
  import { Textarea } from '$lib/components/ui/textarea';
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from '$lib/components/ui/select';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';

  // ---------------------------------------------------------------------------
  // Types
  // ---------------------------------------------------------------------------

  export type FormPayload = {
    insured_person_id: string;
    invoice_date: string;
    /** Zahlungsziel (#288); null when the field was cleared. */
    payment_due_date: string | null;
    invoice_number: string | null;
    provider_name: string;
    provider_type: ProviderType | null;
    total_amount: number;
    notes: string | null;
    ocr_raw: string | null;
    positions: InvoicePositionInput[];
  };

  // ---------------------------------------------------------------------------
  // Props
  // ---------------------------------------------------------------------------

  let {
    mode,
    initialData = undefined,
    insuredOptions,
    cancel,
    disabled = false,
    saving = false,
    formError = null,
    sharedFile = null,
    onSave,
  }: {
    mode: 'create' | 'edit';
    initialData?: InvoiceWithPositions;
    insuredOptions: { id: string; label: string; insuredPerson?: InsuredPerson }[];
    /** Snippet rendered next to the submit button — typically a cancel link from the parent. */
    cancel?: Snippet;
    disabled?: boolean;
    saving?: boolean;
    formError?: string | null;
    /** A file handed in from the PWA share target (issue #158); scanned automatically by the always-visible scanner. */
    sharedFile?: File | null;
    onSave: (payload: FormPayload) => void;
  } = $props();

  // ---------------------------------------------------------------------------
  // State — initialised once from props; the form then owns its own state. The
  // Rechnungskopf + positions live in <InvoiceReview> and are bound back here so
  // this wrapper can assemble the save payload. untrack() marks the initial-value
  // reads as intentionally non-reactive.
  // ---------------------------------------------------------------------------

  let insuredPersonId = $state(
    untrack(() => initialData?.insured_person_id ?? insuredOptions[0]?.id ?? ''),
  );
  let notes = $state(untrack(() => initialData?.notes ?? ''));

  let invoiceDate = $state(
    untrack(() => initialData?.invoice_date ?? new Date().toISOString().slice(0, 10)),
  );
  // Empty in create mode: <InvoiceReview> then prefills it from the Rechnungsdatum
  // plus the configured Standard-Zahlungsfrist (issue #288).
  let paymentDueDate = $state(untrack(() => initialData?.payment_due_date ?? ''));
  let invoiceNumber = $state(untrack(() => initialData?.invoice_number ?? ''));
  let providerName = $state(untrack(() => initialData?.provider_name ?? ''));
  let providerType = $state<ProviderType>(untrack(() => initialData?.provider_type ?? 'arzt'));
  let totalAmount = $state<number>(untrack(() => initialData?.total_amount ?? 0));

  function rowFromPosition(p: InvoiceWithPositions['positions'][number]): ReviewPositionRow {
    const quantity = p.quantity ?? 1;
    // Non-fee-schedule positions are edited as Anzahl × Basis. Older Auslagenersatz
    // rows were stored with base_amount = 0 (only charged_amount was kept); backfill a
    // sensible Basis so the recomputed Gesamtbetrag doesn't collapse to 0 on edit.
    const base_amount =
      isNonScheduleCategory(p.goae_category) && !p.base_amount && p.charged_amount > 0
        ? roundCents(p.charged_amount / quantity)
        : p.base_amount;
    return {
      goae_number: p.goae_number,
      goae_category: p.goae_category ?? null,
      quantity,
      treatment_date: p.treatment_date ?? '',
      description: p.description ?? '',
      multiplier: p.multiplier,
      base_amount,
      charged_amount: p.charged_amount,
      is_valid: p.is_valid ?? null,
      flag_reason: p.flag_reason ?? null,
      confidence: 1,
      // A stored benefit_category is authoritative (previously resolved or a manual
      // override): carry it and pin it so the review's auto-revalidation keeps it
      // instead of re-deriving from the fee table. Legacy rows without one (null)
      // stay unpinned and are seeded on revalidation.
      benefit_category: p.benefit_category ?? null,
      benefit_category_overridden: p.benefit_category != null,
    };
  }

  let positions = $state<ReviewPositionRow[]>(
    untrack(() => initialData?.positions.map(rowFromPosition) ?? []),
  );
  let scanResult = $state<ScanResult | null>(null);

  // OCR raw text is saved by default — users can opt out before saving.
  let saveOcrRaw = $state(true);

  const hasScan = $derived(scanResult !== null);

  // Edit-mode re-parse source: the review shows "Positionen neu einlesen" only
  // when there is stored raw OCR and the invoice is still 'neu'.
  const reparseOcrRaw = $derived(
    mode === 'edit' && initialData?.ocr_raw && initialData?.status.review === 'neu'
      ? initialData.ocr_raw
      : null,
  );

  // ---------------------------------------------------------------------------
  // Reimbursement (eligible_amount) — tariff-dependent, computed here from the
  // reviewed positions' benefit_category (set by the fee-table lookup in the
  // review component) plus the insured person's included_benefits. Shown as a
  // summary line below, so a reduced or zero result is visible *before* saving,
  // and assembled into the save payload.
  // ---------------------------------------------------------------------------

  /**
   * The tariff benefit category resolved and persisted for each position — via the
   * shared {@link resolveBenefitCategory} helper (fee-table lookup, or Auslagen honorar
   * dominance for the Sammelpositionen, issue #251). Also fed to the Erstattungs-Engine
   * and stored on the position so the per-category refund entry can group without a
   * fee-table re-lookup.
   */
  const benefitCategories = $derived.by((): BenefitCategory[] => {
    const honorarPositions: AuslagenDerivationPosition[] = positions.map((p) => ({
      goaeCategory: p.goae_category,
      benefitCategory: p.benefit_category,
      chargedAmount: p.charged_amount,
    }));
    return positions.map((p) => resolveBenefitCategory(p, honorarPositions, providerType));
  });

  const selectedInsuredPerson = $derived(
    insuredOptions.find((o) => o.id === insuredPersonId)?.insuredPerson,
  );

  /**
   * The reimbursement breakdown for the current positions, or `null` when the tariff
   * cannot be evaluated at all (no `included_benefits` or no `start_date` on the
   * insured person) — then every `eligible_amount` stays `null`, i.e. "unknown",
   * which is deliberately different from a computed 0 € ("not reimbursable").
   */
  const erstattung = $derived.by(() => {
    if (!(selectedInsuredPerson?.included_benefits && selectedInsuredPerson.start_date))
      return null;
    const erstattungPositions: ErstattungPosition[] = positions.map((p, i) => ({
      category: benefitCategories[i]!,
      chargedAmount: p.charged_amount,
      treatmentDate: p.treatment_date || invoiceDate,
    }));
    return computeErstattung({
      positions: erstattungPositions,
      benefits: selectedInsuredPerson.included_benefits,
      invoiceDate,
      coverageStart: selectedInsuredPerson.start_date,
    });
  });

  const eligibleAmounts = $derived(
    positions.map((_, i) => erstattung?.byPosition[i]?.eligible_amount ?? null),
  );

  /** Categories the tariff reimburses nothing for — the reason shown to the user. */
  const nonReimbursableCategories = $derived(
    (erstattung?.byCategory ?? []).filter((c) => c.eligibleAmount === 0 && c.chargedAmount > 0),
  );

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  let internalError = $state<string | null>(null);
  const displayError = $derived(internalError ?? formError);

  function handleSubmit() {
    internalError = null;
    if (!insuredPersonId) {
      internalError = 'Bitte eine versicherte Person auswählen.';
      return;
    }
    if (!providerName.trim()) {
      internalError = 'Bitte den Leistungserbringer eingeben.';
      return;
    }
    if (!(totalAmount > 0)) {
      internalError = 'Bitte einen Gesamtbetrag > 0 eingeben.';
      return;
    }
    const positionInputs: InvoicePositionInput[] = positions.map((p, i) => {
      // Non-fee-schedule categories (Auslagenersatz, Arznei-/Hilfsmittel) have no
      // Ziffer/Steigerungsfaktor: clear the Ziffer and fix the Faktor at 1. The
      // Basis (Einzelpreis) is kept — the amount is Anzahl × Basis. The Ziffer field
      // stays hidden but keeps its last value while editing so a category change can
      // be undone; it's only cleared once the position is actually saved.
      const nonSchedule = isNonScheduleCategory(p.goae_category);
      return {
        goae_number: nonSchedule ? '' : p.goae_number,
        goae_category: p.goae_category,
        benefit_category: benefitCategories[i]!,
        quantity: p.quantity,
        // Positions without a date fall back to the invoice date (§5.5 Issue #139).
        treatment_date: p.treatment_date || invoiceDate,
        description: p.description.trim() || null,
        multiplier: nonSchedule ? 1 : p.multiplier,
        base_amount: p.base_amount,
        charged_amount: p.charged_amount,
        eligible_amount: eligibleAmounts[i] ?? null,
        is_valid: p.is_valid,
        flag_reason: p.flag_reason,
      };
    });

    onSave({
      insured_person_id: insuredPersonId,
      invoice_date: invoiceDate,
      payment_due_date: paymentDueDate || null,
      invoice_number: invoiceNumber.trim() || null,
      provider_name: providerName.trim(),
      provider_type: providerType,
      total_amount: totalAmount,
      notes: notes.trim() || null,
      ocr_raw: mode === 'create' && hasScan && saveOcrRaw ? (scanResult?.ocrText ?? null) : null,
      positions: positionInputs,
    });
  }
</script>

<form
  class="flex flex-col gap-4 rounded-lg border border-border bg-card p-5 shadow-sm"
  novalidate
  onsubmit={(e) => {
    e.preventDefault();
    handleSubmit();
  }}
>
  <!-- Versicherte Person -->
  <div class="space-y-1.5">
    <Label for="field-insured">
      Versicherte Person <span class="text-destructive">*</span>
    </Label>
    <Select
      type="single"
      value={insuredPersonId}
      onValueChange={(v: string) => (insuredPersonId = v ?? '')}
      disabled={disabled || insuredOptions.length === 0}
      items={insuredOptions.map((o) => ({ value: o.id, label: o.label }))}
    >
      <SelectTrigger id="field-insured" class="w-full">
        <SelectValue placeholder="Bitte wählen …" />
      </SelectTrigger>
      <SelectContent>
        {#each insuredOptions as opt (opt.id)}
          <SelectItem value={opt.id} label={opt.label} />
        {/each}
      </SelectContent>
    </Select>
  </div>

  <!-- Rechnungskopf + Positionen + OCR scan (shared review component) -->
  <InvoiceReview
    {mode}
    {disabled}
    {sharedFile}
    {reparseOcrRaw}
    showBenefitCategory
    paymentTermDays={$settings.defaultPaymentTermDays}
    bind:invoiceDate
    bind:paymentDueDate
    bind:invoiceNumber
    bind:providerName
    bind:providerType
    bind:totalAmount
    bind:positions
    bind:scanResult
  />

  <!-- Erstattung: what the tariff will cover, and why it is less than billed -->
  {#if erstattung && positions.length > 0}
    <div class="rounded-md border border-border p-3 space-y-1">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <span class="text-sm font-medium">Erstattungsfähig (nach Tarif)</span>
        <span class="text-sm font-semibold tabular-nums">
          {formatEur(erstattung.eligibleAmount)}
        </span>
      </div>
      {#each nonReimbursableCategories as c (c.category)}
        <p class="text-xs text-muted-foreground">
          {BENEFIT_CATEGORY_LABELS[c.category]}: {formatEur(c.chargedAmount)} — {c.note ??
            'nicht erstattungsfähig'}
        </p>
      {/each}
      <p class="text-xs text-muted-foreground">
        Schätzung aus dem Tarif. Maßgeblich ist die später vom Versicherer gemeldete Erstattung.
      </p>
    </div>
  {/if}

  <!-- Notizen -->
  <div class="space-y-1.5">
    <Label for="field-notes">Notizen</Label>
    <Textarea id="field-notes" bind:value={notes} rows={2} {disabled} />
  </div>

  <!-- OCR opt-in checkbox (create mode only, after a scan) -->
  {#if mode === 'create' && hasScan}
    <label class="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
      <input type="checkbox" bind:checked={saveOcrRaw} class="rounded border-border" />
      <span>OCR-Rohtext speichern (ermöglicht späteres Neu-Einlesen; abwählen zum Verwerfen)</span>
    </label>
  {/if}

  {#if displayError}
    <Alert variant="destructive">
      <AlertDescription>{displayError}</AlertDescription>
    </Alert>
  {/if}

  <div class="flex flex-wrap items-center gap-2">
    <Button type="submit" disabled={saving || disabled}>
      {saving
        ? 'Wird gespeichert …'
        : mode === 'create'
          ? 'Rechnung speichern'
          : 'Änderungen speichern'}
    </Button>
    {#if cancel}{@render cancel()}{/if}
  </div>
</form>
