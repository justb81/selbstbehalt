<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Shared invoice form used by both the create page (/invoices/new) and the edit
  page (/invoices/[id]/edit). Mode-specific features:
    create — OCR scanner, OCR opt-in checkbox
    edit   — pre-filled from initialData
  "Positionen prüfen" is available in both modes whenever there are positions.
-->
<script lang="ts">
  import { onDestroy, untrack, type Snippet } from 'svelte';
  import {
    goaeCategoryValues,
    providerTypeValues,
    roundCents,
    type BenefitCategory,
    type GoaeCategory,
    type InvoicePositionInput,
    type InvoiceWithPositions,
    type InsuredPerson,
    type ProviderType,
  } from '@selbstbehalt/shared';
  import {
    DEFAULT_CONFIDENCE_THRESHOLD,
    defaultProviderType,
    disposeScanOcr,
    toReviewPositions,
    type ScanResult,
  } from '$lib/ocr';
  import { loadFeeTable } from '$lib/data/fee-tables';
  import { buildIndex, lookupPosition, type RawPosition } from '$lib/utils/goae-parser';
  import type { FeeScheduleId } from '$lib/data/fee-schedule';
  import { computeErstattung, type ErstattungPosition } from '$lib/utils/erstattungs-engine';
  import OCRScanner from './OCRScanner.svelte';

  // ---------------------------------------------------------------------------
  // Types
  // ---------------------------------------------------------------------------

  type PositionRow = {
    goae_number: string;
    goae_category: GoaeCategory | null;
    quantity: number;
    treatment_date: string; // ISO YYYY-MM-DD or '' for null
    description: string;
    multiplier: number;
    base_amount: number;
    charged_amount: number;
    is_valid: boolean | null;
    flag_reason: string | null;
    confidence: number;
  };

  export type FormPayload = {
    insured_person_id: string;
    invoice_date: string;
    invoice_number: string | null;
    provider_name: string;
    provider_type: ProviderType | null;
    total_amount: number;
    eligible_amount: number | null;
    notes: string | null;
    ocr_raw: string | null;
    positions: InvoicePositionInput[];
  };

  const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
    arzt: 'Arzt/Ärztin',
    zahnarzt: 'Zahnarzt/Zahnärztin',
    krankenhaus: 'Krankenhaus',
    sonstiges: 'Sonstiges',
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
    onSave: (payload: FormPayload) => void;
  } = $props();

  // ---------------------------------------------------------------------------
  // Form state — initialised once from props; the form then owns its own state.
  // untrack() tells Svelte the initial-value reads are intentionally non-reactive.
  // ---------------------------------------------------------------------------

  let insuredPersonId = $state(
    untrack(() => initialData?.insured_person_id ?? insuredOptions[0]?.id ?? ''),
  );
  let invoiceDate = $state(
    untrack(() => initialData?.invoice_date ?? new Date().toISOString().slice(0, 10)),
  );
  let invoiceNumber = $state(untrack(() => initialData?.invoice_number ?? ''));
  let providerName = $state(untrack(() => initialData?.provider_name ?? ''));
  let providerType = $state<ProviderType>(untrack(() => initialData?.provider_type ?? 'arzt'));
  let totalAmount = $state<number>(untrack(() => initialData?.total_amount ?? 0));
  let eligibleAmount = $state<number | null>(untrack(() => initialData?.eligible_amount ?? null));
  let notes = $state(untrack(() => initialData?.notes ?? ''));

  function rowFromPosition(p: InvoiceWithPositions['positions'][number]): PositionRow {
    return {
      goae_number: p.goae_number,
      goae_category: p.goae_category ?? null,
      quantity: p.quantity ?? 1,
      treatment_date: p.treatment_date ?? '',
      description: p.description ?? '',
      multiplier: p.multiplier,
      base_amount: p.base_amount,
      charged_amount: p.charged_amount,
      is_valid: p.is_valid ?? null,
      flag_reason: p.flag_reason ?? null,
      confidence: 1,
    };
  }

  let positions = $state<PositionRow[]>(
    untrack(() => initialData?.positions.map(rowFromPosition) ?? []),
  );

  function addPosition() {
    positions = [
      ...positions,
      {
        goae_number: '',
        goae_category: 'GOÄ' as GoaeCategory,
        quantity: 1,
        treatment_date: '',
        description: '',
        multiplier: 2.3,
        base_amount: 0,
        charged_amount: 0,
        is_valid: null,
        flag_reason: null,
        confidence: 1,
      },
    ];
  }

  function removePosition(i: number) {
    positions = positions.filter((_, idx) => idx !== i);
  }

  // ---------------------------------------------------------------------------
  // OCR (create mode only)
  // ---------------------------------------------------------------------------

  let scanResult = $state<ScanResult | null>(null);
  let showScanner = $state(false);
  let ocrSchedule = $state<FeeScheduleId>('GOÄ');
  let saveOcrRaw = $state(false);

  const hasScan = $derived(scanResult !== null);
  const lowConfidence = $derived(
    scanResult !== null && scanResult.meanConfidence < DEFAULT_CONFIDENCE_THRESHOLD,
  );
  const flaggedCount = $derived(positions.filter((p) => p.is_valid === false).length);

  function onScanned(result: ScanResult): void {
    scanResult = result;
    showScanner = false;
    if (result.parsed.invoiceDate) invoiceDate = result.parsed.invoiceDate;
    if (result.parsed.invoiceNumber) invoiceNumber = result.parsed.invoiceNumber;
    if (result.parsed.providerName) providerName = result.parsed.providerName;
    providerType = defaultProviderType(result.schedule);
    positions = toReviewPositions(result).map((p) => ({
      goae_number: p.goaeNumber,
      goae_category: result.schedule as GoaeCategory,
      quantity: p.quantity,
      treatment_date: p.treatmentDate ?? '',
      description: p.description ?? '',
      multiplier: p.multiplier,
      base_amount: p.baseAmount,
      charged_amount: p.chargedAmount,
      is_valid: p.isValid,
      flag_reason: p.flagReason,
      confidence: p.confidence,
    }));
    if (positions.length > 0) {
      totalAmount = roundCents(positions.reduce((s, p) => s + p.charged_amount, 0));
    }
  }

  // Teardown the OCR worker when the page unmounts (no-op in edit mode since
  // the scanner is never initialised there).
  onDestroy(disposeScanOcr);

  // ---------------------------------------------------------------------------
  // Re-validate positions
  // ---------------------------------------------------------------------------

  let revalidating = $state(false);
  let revalidateError = $state<string | null>(null);

  function categoryToSchedule(cat: GoaeCategory | null): FeeScheduleId {
    if (cat === 'GOZ') return 'GOZ';
    if (cat === 'GOT') return 'GOT';
    return 'GOÄ'; // GOÄ and UV-GOÄ both validate against the GOÄ table
  }

  async function revalidatePositions() {
    if (positions.length === 0) return;
    revalidating = true;
    revalidateError = null;
    try {
      const schedules = new Set(positions.map((p) => categoryToSchedule(p.goae_category)));
      const tableEntries = await Promise.all(
        [...schedules].map(async (s) => [s, await loadFeeTable(s)] as const),
      );
      const tables = new Map(tableEntries);
      const indexes = new Map([...tables.entries()].map(([s, t]) => [s, buildIndex(t)]));

      // Collect benefitCategory per position for eligible_amount computation below.
      const benefitCategories: (BenefitCategory | null)[] = [];

      positions = positions.map((pos) => {
        const schedule = categoryToSchedule(pos.goae_category);
        const table = tables.get(schedule)!;
        const index = indexes.get(schedule)!;
        const raw: RawPosition = {
          ziffer: pos.goae_number,
          quantity: pos.quantity,
          multiplier: pos.multiplier,
          chargedAmount: pos.charged_amount,
          raw: pos.goae_number,
          treatmentDate: pos.treatment_date || null,
          detectedSchedule: null,
        };
        const result = lookupPosition(raw, table, index);
        benefitCategories.push(result.benefitCategory);
        return {
          ...pos,
          // Supplement description from fee table if currently empty.
          description: pos.description || result.description || '',
          // Always take base_amount from the table when the Ziffer is known.
          base_amount: result.baseAmount ?? pos.base_amount,
          is_valid: result.isValid,
          flag_reason: result.flags.length > 0 ? result.flags.map((f) => f.reason).join(' ') : null,
        };
      });

      // Propagate treatment_date forward: positions without their own date
      // inherit from the nearest preceding position that has one.
      let lastDate = '';
      positions = positions.map((pos) => {
        if (pos.treatment_date) {
          lastDate = pos.treatment_date;
          return pos;
        }
        return lastDate ? { ...pos, treatment_date: lastDate } : pos;
      });

      // Recalculate eligible_amount when the insured person's tariff data is
      // available. Positions with an unknown Ziffer (benefitCategory == null)
      // fall back to 'sonstiges'; the tariff will return 0 for uncovered areas.
      const insuredPerson = insuredOptions.find((o) => o.id === insuredPersonId)?.insuredPerson;
      if (insuredPerson?.included_benefits && insuredPerson.start_date) {
        const erstattungPositions: ErstattungPosition[] = positions.map((pos, i) => ({
          category: (benefitCategories[i] ?? 'sonstiges') as BenefitCategory,
          chargedAmount: pos.charged_amount,
        }));
        const result = computeErstattung({
          positions: erstattungPositions,
          benefits: insuredPerson.included_benefits,
          invoiceDate,
          coverageStart: insuredPerson.start_date,
        });
        eligibleAmount = result.eligibleAmount;
      }
    } catch (e) {
      revalidateError = e instanceof Error ? e.message : 'Neuprüfung fehlgeschlagen.';
    } finally {
      revalidating = false;
    }
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

    const positionInputs: InvoicePositionInput[] = positions.map((p) => ({
      goae_number: p.goae_number,
      goae_category: p.goae_category,
      quantity: p.quantity,
      treatment_date: p.treatment_date || null,
      description: p.description.trim() || null,
      multiplier: p.multiplier,
      base_amount: p.base_amount,
      charged_amount: p.charged_amount,
      is_valid: p.is_valid,
      flag_reason: p.flag_reason,
    }));

    onSave({
      insured_person_id: insuredPersonId,
      invoice_date: invoiceDate,
      invoice_number: invoiceNumber.trim() || null,
      provider_name: providerName.trim(),
      provider_type: providerType,
      total_amount: totalAmount,
      eligible_amount: eligibleAmount,
      notes: notes.trim() || null,
      ocr_raw: mode === 'create' && hasScan && saveOcrRaw ? (scanResult?.ocrText ?? null) : null,
      positions: positionInputs,
    });
  }
</script>

<form
  class="card"
  novalidate
  onsubmit={(e) => {
    e.preventDefault();
    handleSubmit();
  }}
>
  <!-- OCR section (create mode only) -->
  {#if mode === 'create'}
    <div class="scan-section">
      <div class="scan-row">
        {#if !showScanner}
          <button
            type="button"
            class="btn-secondary"
            onclick={() => (showScanner = true)}
            {disabled}
          >
            {hasScan ? 'Neu scannen / hochladen' : 'Rechnung scannen / hochladen'}
          </button>
          {#if hasScan}
            <span class="scan-done">✓ Aus Scan übernommen – bitte prüfen</span>
          {:else}
            <span class="scan-hint">
              Optional. Die Erkennung läuft auf diesem Gerät; das Bild verlässt es nie.
            </span>
          {/if}
        {:else}
          <button type="button" class="btn-text" onclick={() => (showScanner = false)}>
            Schließen
          </button>
        {/if}
      </div>
      {#if showScanner}
        <OCRScanner bind:schedule={ocrSchedule} {onScanned} />
      {/if}
    </div>

    {#if hasScan && lowConfidence}
      <p class="notice warning" role="status">
        Geringe Erkennungsgenauigkeit – bitte alle Felder und Positionen sorgfältig prüfen.
      </p>
    {/if}
    {#if hasScan && flaggedCount > 0}
      <p class="notice warning" role="status">
        {flaggedCount}
        {flaggedCount === 1 ? 'Position ist' : 'Positionen sind'} auffällig und markiert.
      </p>
    {/if}
    {#if hasScan && (scanResult?.parsed.violations.length ?? 0) > 0}
      <ul class="violations">
        {#each scanResult?.parsed.violations ?? [] as violation (violation.message)}
          <li>{violation.message}</li>
        {/each}
      </ul>
    {/if}
  {/if}

  <!-- Header fields -->
  <h2>Rechnungskopf</h2>
  <div class="field-grid">
    <label class="field">
      <span>Versicherte Person <span class="req">*</span></span>
      <select bind:value={insuredPersonId} required {disabled}>
        <option value="" disabled>Bitte wählen …</option>
        {#each insuredOptions as opt (opt.id)}
          <option value={opt.id}>{opt.label}</option>
        {/each}
      </select>
    </label>

    <label class="field">
      <span>Rechnungsdatum <span class="req">*</span></span>
      <input type="date" bind:value={invoiceDate} required {disabled} />
    </label>

    <label class="field">
      <span>Rechnungsnummer</span>
      <input type="text" bind:value={invoiceNumber} placeholder="optional" {disabled} />
    </label>

    <label class="field">
      <span>Leistungserbringer <span class="req">*</span></span>
      <input type="text" bind:value={providerName} required {disabled} />
    </label>

    <label class="field">
      <span>Art</span>
      <select bind:value={providerType} {disabled}>
        {#each providerTypeValues as t (t)}
          <option value={t}>{PROVIDER_TYPE_LABELS[t]}</option>
        {/each}
      </select>
    </label>

    <label class="field">
      <span>Rechnungsbetrag (€) <span class="req">*</span></span>
      <input type="number" bind:value={totalAmount} min="0" step="0.01" required {disabled} />
    </label>

    <label class="field">
      <span>Erstattungsfähiger Betrag (€)</span>
      <input
        type="number"
        value={eligibleAmount ?? ''}
        oninput={(e) => {
          const v = (e.target as HTMLInputElement).value;
          eligibleAmount = v ? parseFloat(v) : null;
        }}
        min="0"
        step="0.01"
        placeholder="optional"
        {disabled}
      />
    </label>
  </div>

  <label class="field">
    <span>Notizen</span>
    <textarea bind:value={notes} rows="2" {disabled}></textarea>
  </label>

  <!-- Positions -->
  <div class="positions-section">
    <div class="positions-header">
      <h2>GOÄ/GOZ-Positionen</h2>
      <div class="positions-header-actions">
        <button
          type="button"
          class="btn-secondary"
          onclick={revalidatePositions}
          disabled={revalidating || disabled || positions.length === 0}
        >
          {revalidating ? 'Wird geprüft …' : 'Positionen prüfen'}
        </button>
        <button type="button" class="btn-text" onclick={addPosition} {disabled}>
          + Position hinzufügen
        </button>
      </div>
    </div>

    {#if revalidateError}
      <p class="error" role="alert">{revalidateError}</p>
    {/if}

    {#if positions.length > 0}
      <div class="pos-table">
        <div class="pos-head">
          <span>Datum</span>
          <span>Ziffer</span>
          <span>Kat.</span>
          <span>Beschreibung</span>
          <span class="num">Faktor</span>
          <span class="num">Anz.</span>
          <span class="num">Basis (€)</span>
          <span class="num">Betrag (€)</span>
          <span></span>
        </div>
        {#each positions as pos, i (i)}
          <div class="pos-row" class:flagged={pos.is_valid === false}>
            <input type="date" bind:value={pos.treatment_date} {disabled} />
            <input
              type="text"
              bind:value={pos.goae_number}
              placeholder="z.B. 1"
              required
              {disabled}
            />
            <select bind:value={pos.goae_category} {disabled}>
              {#each goaeCategoryValues as cat (cat)}
                <option value={cat}>{cat}</option>
              {/each}
            </select>
            <div class="desc-cell">
              <input type="text" bind:value={pos.description} placeholder="optional" {disabled} />
              {#if pos.is_valid === false && pos.flag_reason}
                <small class="flag">⚠ {pos.flag_reason}</small>
              {/if}
              {#if pos.confidence < DEFAULT_CONFIDENCE_THRESHOLD}
                <small class="uncertain">Unsichere Erkennung – bitte prüfen.</small>
              {/if}
            </div>
            <input
              class="num"
              type="number"
              bind:value={pos.multiplier}
              min="0.01"
              step="0.01"
              required
              {disabled}
            />
            <input
              class="num"
              type="number"
              bind:value={pos.quantity}
              min="1"
              step="1"
              required
              {disabled}
            />
            <input
              class="num"
              type="number"
              bind:value={pos.base_amount}
              min="0"
              step="0.01"
              required
              {disabled}
            />
            <input
              class="num"
              type="number"
              bind:value={pos.charged_amount}
              min="0"
              step="0.01"
              required
              {disabled}
            />
            <button
              type="button"
              class="btn-icon danger"
              onclick={() => removePosition(i)}
              aria-label="Position {i + 1} entfernen"
              {disabled}
            >
              ✕
            </button>
          </div>
        {/each}
      </div>
    {:else}
      <p class="muted">Noch keine Positionen. Positionen sind optional.</p>
    {/if}
  </div>

  <!-- OCR opt-in checkbox (create mode only, after a scan) -->
  {#if mode === 'create' && hasScan}
    <label class="checkbox">
      <input type="checkbox" bind:checked={saveOcrRaw} />
      <span>OCR-Rohtext zur späteren Kontrolle speichern (optional, Opt-in)</span>
    </label>
  {/if}

  {#if displayError}
    <p class="error" role="alert">{displayError}</p>
  {/if}

  <div class="actions">
    <button type="submit" class="btn-primary" disabled={saving || disabled}>
      {saving
        ? 'Wird gespeichert …'
        : mode === 'create'
          ? 'Rechnung speichern'
          : 'Änderungen speichern'}
    </button>
    {#if cancel}{@render cancel()}{/if}
  </div>
</form>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
  }

  h2 {
    margin: 0;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
  }

  /* Scan section */
  .scan-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--color-border);
  }

  .scan-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }

  .scan-done {
    font-size: var(--font-size-sm);
    color: var(--color-success, #16a34a);
  }

  .scan-hint {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  /* OCR warnings */
  .notice {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
  }

  .notice.warning {
    background: color-mix(in srgb, var(--color-warning) 12%, var(--color-surface));
    color: var(--color-warning);
  }

  .violations {
    margin: 0;
    padding-left: var(--space-5);
    color: var(--color-warning);
    font-size: var(--font-size-sm);
  }

  /* Header fields */
  .field-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
    gap: var(--space-3);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .field input,
  .field select,
  .field textarea {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font: inherit;
    color: var(--color-text);
    background: var(--color-bg);
    resize: vertical;
  }

  .field input:focus,
  .field select:focus,
  .field textarea:focus {
    outline: 2px solid var(--color-primary);
    outline-offset: 1px;
  }

  .req {
    color: var(--color-danger);
  }

  /* Positions */
  .positions-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .positions-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .positions-header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .pos-table {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
    overflow-x: auto;
  }

  .pos-head,
  .pos-row {
    display: grid;
    /* Datum | Ziffer | Kat. | Beschreibung | Faktor | Anz. | Basis | Betrag | Del */
    grid-template-columns: 8rem 5rem 4rem 1fr 5rem 3.5rem 6.5rem 6.5rem 2rem;
    gap: var(--space-2);
    align-items: start;
    padding: var(--space-2) var(--space-3);
  }

  .pos-head {
    background: var(--color-bg);
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--color-text-muted);
    border-bottom: 1px solid var(--color-border);
  }

  .pos-row {
    border-bottom: 1px solid var(--color-border);
  }

  .pos-row:last-child {
    border-bottom: none;
  }

  .pos-row.flagged {
    background: color-mix(in srgb, var(--color-warning) 8%, var(--color-surface));
  }

  .pos-row input,
  .pos-row select {
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font: inherit;
    min-width: 0;
    width: 100%;
  }

  .pos-row input:focus,
  .pos-row select:focus {
    outline: 2px solid var(--color-primary);
    outline-offset: 1px;
  }

  .num {
    text-align: right;
  }

  .pos-row input.num {
    text-align: right;
  }

  .desc-cell {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .desc-cell input {
    width: 100%;
  }

  .flag {
    font-size: var(--font-size-sm);
    color: var(--color-warning);
  }

  .uncertain {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    font-style: italic;
  }

  /* OCR opt-in */
  .checkbox {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  /* Actions */
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }

  /* Buttons */
  .btn-primary {
    padding: var(--space-2) var(--space-5);
    border: none;
    border-radius: var(--radius-sm);
    background: var(--color-primary);
    color: var(--color-primary-contrast);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--color-primary-strong);
  }

  .btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-secondary {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    font-weight: 500;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    cursor: pointer;
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--color-bg);
  }

  .btn-secondary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-text {
    border: none;
    background: none;
    color: var(--color-primary);
    font: inherit;
    font-size: var(--font-size-sm);
    cursor: pointer;
    padding: 0;
    text-decoration: underline;
  }

  .btn-text:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-icon {
    width: 1.8rem;
    height: 1.8rem;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--color-bg);
    color: var(--color-text-muted);
    font: inherit;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .btn-icon.danger:hover:not(:disabled) {
    color: var(--color-danger);
    background: color-mix(in srgb, var(--color-danger) 10%, white);
  }

  .btn-icon:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .muted {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    margin: 0;
  }

  .error {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
    margin: 0;
  }
</style>
