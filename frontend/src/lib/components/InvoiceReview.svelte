<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  InvoiceReview (docs/design.md §6.2, issue #26 / #22): shows a parsed invoice for
  manual correction before saving. Header fields and each line are editable; §5
  flags, cross-number violations and low-confidence OCR reads are surfaced so the
  user can fix them. On confirmation it emits the `POST /api/invoices` payload —
  metadata only, with the raw OCR text included solely on explicit opt-in
  (datenminimierung, docs/design.md §8.1/§8.2).
-->
<script lang="ts">
  import { ZodError } from 'zod';
  import {
    formatEur,
    providerTypeValues,
    roundCents,
    type InvoiceCreatePayload,
    type ProviderType,
  } from '@selbstbehalt/shared';

  import {
    DEFAULT_CONFIDENCE_THRESHOLD,
    defaultProviderType,
    toInvoicePayload,
    toReviewPositions,
    type InsuredOption,
    type ReviewPosition,
    type ReviewState,
    type ScanResult,
  } from '$lib/ocr/scan-flow';

  let {
    scan,
    insuredPersons,
    saving = false,
    confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
    onSubmit,
    onRetake,
  }: {
    scan: ScanResult;
    insuredPersons: InsuredOption[];
    saving?: boolean;
    confidenceThreshold?: number;
    onSubmit: (payload: InvoiceCreatePayload) => void;
    onRetake?: () => void;
  } = $props();

  const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
    arzt: 'Arzt/Ärztin',
    zahnarzt: 'Zahnarzt/Zahnärztin',
    krankenhaus: 'Krankenhaus',
    sonstiges: 'Sonstiges',
  };

  const todayIso = new Date().toISOString().slice(0, 10);

  // Local, editable copy of the parsed invoice. Seeded once from the scan; the
  // component remounts on a re-scan, so capturing the initial props is intended.
  // svelte-ignore state_referenced_locally
  let insuredPersonId = $state(insuredPersons[0]?.id ?? '');
  // svelte-ignore state_referenced_locally
  let invoiceDate = $state(scan.parsed.invoiceDate ?? todayIso);
  // svelte-ignore state_referenced_locally
  let invoiceNumber = $state(scan.parsed.invoiceNumber ?? '');
  // svelte-ignore state_referenced_locally
  let providerName = $state(scan.parsed.providerName ?? '');
  // svelte-ignore state_referenced_locally
  let providerType = $state<ProviderType>(defaultProviderType(scan.schedule));
  // svelte-ignore state_referenced_locally
  let positions = $state<ReviewPosition[]>(toReviewPositions(scan));
  let saveOcrRaw = $state(false);
  let formError = $state<string | null>(null);

  const total = $derived(roundCents(positions.reduce((sum, p) => sum + (p.chargedAmount || 0), 0)));
  const flaggedCount = $derived(positions.filter((p) => !p.isValid).length);
  const lowConfidence = $derived(scan.meanConfidence < confidenceThreshold);

  function removePosition(index: number): void {
    positions = positions.filter((_, i) => i !== index);
  }

  function submit(): void {
    formError = null;
    if (!insuredPersonId) {
      formError = 'Bitte eine versicherte Person auswählen.';
      return;
    }
    if (positions.length === 0) {
      formError = 'Die Rechnung enthält keine Positionen.';
      return;
    }
    // Catch an empty/zero Faktor here so the message names the line, rather than
    // surfacing the schema's line-less `.positive()` error from toInvoicePayload.
    const badFactor = positions.findIndex((p) => !(p.multiplier > 0));
    if (badFactor !== -1) {
      formError = `Position ${badFactor + 1}: Der Steigerungsfaktor muss größer als 0 sein.`;
      return;
    }
    const state: ReviewState = {
      insuredPersonId,
      invoiceDate,
      invoiceNumber: invoiceNumber.trim() || null,
      providerName: providerName.trim(),
      providerType,
      schedule: scan.schedule,
      positions,
      ocrRaw: saveOcrRaw ? scan.ocrText : null,
    };
    try {
      onSubmit(toInvoicePayload(state));
    } catch (err) {
      formError =
        err instanceof ZodError
          ? (err.issues[0]?.message ?? 'Die Rechnung ist unvollständig.')
          : 'Die Rechnung konnte nicht gespeichert werden.';
    }
  }
</script>

<form
  class="review"
  onsubmit={(e) => {
    e.preventDefault();
    submit();
  }}
>
  <div class="grid">
    <label class="field">
      <span>Versicherte Person</span>
      <select bind:value={insuredPersonId} required>
        {#if insuredPersons.length === 0}
          <option value="" disabled>Keine versicherte Person vorhanden</option>
        {:else}
          <option value="" disabled>Bitte wählen …</option>
          {#each insuredPersons as person (person.id)}
            <option value={person.id}>{person.label}</option>
          {/each}
        {/if}
      </select>
    </label>

    <label class="field">
      <span>Rechnungsdatum</span>
      <input type="date" bind:value={invoiceDate} required />
    </label>

    <label class="field">
      <span>Rechnungsnummer</span>
      <input type="text" bind:value={invoiceNumber} placeholder="optional" />
    </label>

    <label class="field">
      <span>Leistungserbringer</span>
      <input type="text" bind:value={providerName} required />
    </label>

    <label class="field">
      <span>Art</span>
      <select bind:value={providerType}>
        {#each providerTypeValues as type (type)}
          <option value={type}>{PROVIDER_TYPE_LABELS[type]}</option>
        {/each}
      </select>
    </label>

    <div class="field">
      <span>Gebührenordnung</span>
      <output>{scan.schedule}</output>
    </div>
  </div>

  {#if lowConfidence}
    <p class="notice warning" role="status">
      Geringe Erkennungsgenauigkeit – bitte alle Felder und Positionen sorgfältig prüfen.
    </p>
  {/if}

  {#if flaggedCount > 0}
    <p class="notice warning" role="status">
      {flaggedCount}
      {flaggedCount === 1 ? 'Position ist' : 'Positionen sind'} auffällig und markiert.
    </p>
  {/if}

  {#if scan.parsed.violations.length > 0}
    <ul class="violations">
      {#each scan.parsed.violations as violation (violation.message)}
        <li>{violation.message}</li>
      {/each}
    </ul>
  {/if}

  <div class="positions" role="table" aria-label="Rechnungspositionen">
    <div class="position-row head" role="row">
      <span role="columnheader">Ziffer</span>
      <span role="columnheader">Beschreibung</span>
      <span role="columnheader">Faktor</span>
      <span role="columnheader">Betrag</span>
      <span role="columnheader"><span class="visually-hidden">Aktionen</span></span>
    </div>

    {#each positions as position, index (index)}
      <div class="position-row" class:flagged={!position.isValid} role="row">
        <input
          class="ziffer"
          type="text"
          bind:value={position.goaeNumber}
          aria-label="Ziffer Position {index + 1}"
        />
        <span class="desc">
          <input
            type="text"
            bind:value={position.description}
            aria-label="Beschreibung Position {index + 1}"
            placeholder="—"
          />
          {#if !position.isValid && position.flagReason}
            <small class="flag" role="note">⚠ {position.flagReason}</small>
          {/if}
          {#if position.confidence < confidenceThreshold}
            <small class="uncertain">Unsichere Erkennung – bitte prüfen.</small>
          {/if}
        </span>
        <input
          class="num"
          type="number"
          step="0.1"
          min="0.1"
          bind:value={position.multiplier}
          aria-label="Faktor Position {index + 1}"
        />
        <input
          class="num"
          type="number"
          step="0.01"
          min="0"
          bind:value={position.chargedAmount}
          aria-label="Betrag Position {index + 1}"
        />
        <button
          type="button"
          class="remove"
          onclick={() => removePosition(index)}
          aria-label="Position {index + 1} entfernen"
        >
          ✕
        </button>
      </div>
    {/each}
  </div>

  <p class="total">Gesamtbetrag: <strong>{formatEur(total)}</strong></p>

  <label class="checkbox">
    <input type="checkbox" bind:checked={saveOcrRaw} />
    <span>OCR-Rohtext zur späteren Kontrolle speichern (optional, Opt-in)</span>
  </label>

  {#if formError}
    <p class="error" role="alert">{formError}</p>
  {/if}

  <div class="actions">
    <button type="submit" class="primary" disabled={saving}>
      {saving ? 'Wird gespeichert …' : 'Rechnung speichern'}
    </button>
    {#if onRetake}
      <button type="button" onclick={onRetake} disabled={saving}>Neu scannen</button>
    {/if}
  </div>
</form>

<style>
  .review {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
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
  .field output {
    padding: var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font: inherit;
    color: var(--color-text);
    background: var(--color-surface);
  }

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

  .positions {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .position-row {
    display: grid;
    grid-template-columns: 5rem 1fr 5rem 7rem 2.5rem;
    gap: var(--space-2);
    align-items: start;
    padding: var(--space-2);
    border-top: 1px solid var(--color-border);
  }

  .position-row.head {
    border-top: none;
    background: var(--color-bg);
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--color-text-muted);
  }

  .position-row.flagged {
    background: color-mix(in srgb, var(--color-warning) 8%, var(--color-surface));
  }

  .position-row input {
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font: inherit;
    min-width: 0;
  }

  .position-row .num {
    text-align: right;
  }

  .desc {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .flag {
    color: var(--color-warning);
  }

  .uncertain {
    color: var(--color-text-muted);
    font-style: italic;
  }

  .remove {
    border: none;
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: var(--font-size-base);
  }

  .remove:hover {
    color: var(--color-danger);
  }

  .total {
    margin: 0;
    text-align: right;
    font-size: var(--font-size-lg);
  }

  .checkbox {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  button {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
  }

  button.primary {
    border-color: transparent;
    background: var(--color-primary);
    color: var(--color-primary-contrast);
  }

  button.primary:hover:not(:disabled) {
    background: var(--color-primary-strong);
  }

  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .error {
    margin: 0;
    color: var(--color-danger);
    font-size: var(--font-size-sm);
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
</style>
