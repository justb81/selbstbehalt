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
    - the OCR opt-out (raw OCR saved by default), and
    - assembling + saving the payload.
  Mode-specific: create shows the scanner + OCR opt-out; edit pre-fills from
  initialData and offers "Positionen neu einlesen" when ocr_raw is stored.
-->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import {
    isFlatReimbursedCategory,
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
      benefit_category: null,
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
    mode === 'edit' && initialData?.ocr_raw && initialData?.status === 'neu'
      ? initialData.ocr_raw
      : null,
  );

  // ---------------------------------------------------------------------------
  // Reimbursement (eligible_amount) — tariff-dependent, computed here from the
  // reviewed positions' benefit_category (set by the fee-table lookup in the
  // review component) plus the insured person's included_benefits. Not shown in
  // the form; only assembled into the save payload.
  // ---------------------------------------------------------------------------

  /**
   * The tariff benefit category resolved and persisted for each position — via the
   * shared {@link resolveBenefitCategory} helper (fee-table lookup, or Auslagen honorar
   * dominance for the Sammelpositionen, issue #251). Also fed to the Erstattungs-Engine
   * and stored on the position so the per-category refund entry can group without a
   * fee-table re-lookup.
   */
  function resolvedBenefitCategories(): BenefitCategory[] {
    const honorarPositions: AuslagenDerivationPosition[] = positions.map((p) => ({
      goaeCategory: p.goae_category,
      benefitCategory: p.benefit_category,
      chargedAmount: p.charged_amount,
    }));
    return positions.map((p) => resolveBenefitCategory(p, honorarPositions, providerType));
  }

  function computeEligibleAmounts(categories: BenefitCategory[]): (number | null)[] {
    const insuredPerson = insuredOptions.find((o) => o.id === insuredPersonId)?.insuredPerson;
    if (!(insuredPerson?.included_benefits && insuredPerson.start_date)) {
      return positions.map(() => null);
    }
    const erstattungPositions: ErstattungPosition[] = positions.map((p, i) => ({
      category: categories[i]!,
      chargedAmount: p.charged_amount,
      treatmentDate: p.treatment_date || invoiceDate,
      // Only Arznei-/Hilfsmittel is reimbursed flat at 100 %, outside the tariff
      // pipeline (provisional; corrected later by the insurer's refund_amount).
      // Auslagenersatz and Material-/Laborkosten run the §5.1 pipeline under their
      // derived benefit_category.
      isFullyReimbursed: isFlatReimbursedCategory(p.goae_category),
    }));
    const result = computeErstattung({
      positions: erstattungPositions,
      benefits: insuredPerson.included_benefits,
      invoiceDate,
      coverageStart: insuredPerson.start_date,
    });
    return positions.map((_, i) => result.byPosition[i]?.eligible_amount ?? null);
  }

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
    const benefitCategories = resolvedBenefitCategories();
    const eligibleAmounts = computeEligibleAmounts(benefitCategories);
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
        // Positions without a date fall back to the invoice date (§3.2 Issue #139).
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
    bind:invoiceDate
    bind:invoiceNumber
    bind:providerName
    bind:providerType
    bind:totalAmount
    bind:positions
    bind:scanResult
  />

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
