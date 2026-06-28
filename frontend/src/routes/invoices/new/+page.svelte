<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Manuelle Rechnungserfassung (docs/design.md §6.1, issue #22): form for
  entering an invoice with GOÄ/GOZ/GOT positions without the OCR scanner.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import {
    goaeCategoryValues,
    providerTypeValues,
    type GoaeCategory,
    type InsuredPerson,
    type InvoicePositionInput,
    type ProviderType,
  } from '@selbstbehalt/shared';

  const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
    arzt: 'Arzt/Ärztin',
    zahnarzt: 'Zahnarzt/Zahnärztin',
    krankenhaus: 'Krankenhaus',
    sonstiges: 'Sonstiges',
  };

  // ---- Load insured persons ----
  type InsuredOption = { id: string; label: string; insuredPerson: InsuredPerson };
  let insuredOptions = $state<InsuredOption[]>([]);
  let loadingPersons = $state(true);
  let loadError = $state<string | null>(null);

  async function loadPersons() {
    loadingPersons = true;
    loadError = null;
    try {
      const contracts = await api.contracts.list();
      const lists = await Promise.all(
        contracts.map(async (c) => {
          const persons = await api.insured.list(c.id);
          return persons.map((ip) => ({
            id: ip.id,
            label: `${c.insurer_name} · ${ip.tariff_name ?? ip.kvnr ?? 'Tarif'}`,
            insuredPerson: ip,
          }));
        }),
      );
      insuredOptions = lists.flat();
    } catch {
      loadError = 'Versicherte Personen konnten nicht geladen werden.';
    } finally {
      loadingPersons = false;
    }
  }

  onMount(loadPersons);

  // ---- Form state ----
  let insuredPersonId = $state('');
  let invoiceDate = $state(new Date().toISOString().slice(0, 10));
  let invoiceNumber = $state('');
  let providerName = $state('');
  let providerType = $state<ProviderType>('arzt');
  let totalAmount = $state<number>(0);
  let eligibleAmount = $state<number | null>(null);
  let notes = $state('');

  type PositionRow = {
    goae_number: string;
    goae_category: GoaeCategory | null;
    description: string;
    multiplier: number;
    base_amount: number;
    charged_amount: number;
  };

  let positions = $state<PositionRow[]>([]);

  function addPosition() {
    positions = [
      ...positions,
      {
        goae_number: '',
        goae_category: 'GOÄ' as GoaeCategory,
        description: '',
        multiplier: 2.3,
        base_amount: 0,
        charged_amount: 0,
      },
    ];
  }

  function removePosition(i: number) {
    positions = positions.filter((_, idx) => idx !== i);
  }

  let saving = $state(false);
  let formError = $state<string | null>(null);

  async function submit() {
    formError = null;
    if (!insuredPersonId) {
      formError = 'Bitte eine versicherte Person auswählen.';
      return;
    }
    if (!providerName.trim()) {
      formError = 'Bitte den Leistungserbringer eingeben.';
      return;
    }
    if (!(totalAmount > 0)) {
      formError = 'Bitte einen Gesamtbetrag > 0 eingeben.';
      return;
    }

    const positionInputs: InvoicePositionInput[] = positions.map((p) => ({
      goae_number: p.goae_number,
      goae_category: p.goae_category,
      description: p.description.trim() || null,
      multiplier: p.multiplier,
      base_amount: p.base_amount,
      charged_amount: p.charged_amount,
      is_valid: null,
      flag_reason: null,
    }));

    saving = true;
    try {
      const invoice = await api.invoices.create({
        insured_person_id: insuredPersonId,
        invoice_date: invoiceDate,
        invoice_number: invoiceNumber.trim() || null,
        provider_name: providerName.trim(),
        provider_type: providerType,
        total_amount: totalAmount,
        eligible_amount: eligibleAmount,
        notes: notes.trim() || null,
        positions: positionInputs.length > 0 ? positionInputs : undefined,
      });
      await goto(resolve('/invoices/[id]', { id: invoice.id }));
    } catch (e) {
      formError =
        e instanceof ApiError || e instanceof Error
          ? e.message
          : 'Rechnung konnte nicht gespeichert werden.';
      saving = false;
    }
  }
</script>

<svelte:head><title>Rechnung erfassen · selbstbehalt</title></svelte:head>

<section class="page">
  <div class="back-row">
    <a href={resolve('/invoices')} class="back-link">← Rechnungen</a>
  </div>
  <h1>Rechnung manuell erfassen</h1>

  {#if loadingPersons}
    <p class="muted">Daten werden geladen …</p>
  {:else if loadError}
    <p class="error" role="alert">{loadError}</p>
  {:else if insuredOptions.length === 0}
    <div class="empty-notice">
      <p>Noch keine versicherten Personen vorhanden.</p>
      <a href={resolve('/contracts/new')} class="btn-primary">Vertrag anlegen</a>
    </div>
  {:else}
    <form
      class="card"
      onsubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h2>Rechnungskopf</h2>
      <div class="field-grid">
        <label class="field">
          <span>Versicherte Person <span class="req">*</span></span>
          <select bind:value={insuredPersonId} required>
            <option value="" disabled>Bitte wählen …</option>
            {#each insuredOptions as opt (opt.id)}
              <option value={opt.id}>{opt.label}</option>
            {/each}
          </select>
        </label>

        <label class="field">
          <span>Rechnungsdatum <span class="req">*</span></span>
          <input type="date" bind:value={invoiceDate} required />
        </label>

        <label class="field">
          <span>Rechnungsnummer</span>
          <input type="text" bind:value={invoiceNumber} placeholder="optional" />
        </label>

        <label class="field">
          <span>Leistungserbringer <span class="req">*</span></span>
          <input type="text" bind:value={providerName} required />
        </label>

        <label class="field">
          <span>Art</span>
          <select bind:value={providerType}>
            {#each providerTypeValues as t (t)}
              <option value={t}>{PROVIDER_TYPE_LABELS[t]}</option>
            {/each}
          </select>
        </label>

        <label class="field">
          <span>Rechnungsbetrag (€) <span class="req">*</span></span>
          <input type="number" bind:value={totalAmount} min="0" step="0.01" required />
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
          />
        </label>
      </div>

      <label class="field">
        <span>Notizen</span>
        <textarea bind:value={notes} rows="2"></textarea>
      </label>

      <!-- Positions -->
      <div class="positions-section">
        <div class="positions-header">
          <h2>GOÄ/GOZ-Positionen</h2>
          <button type="button" class="btn-text" onclick={addPosition}>+ Position hinzufügen</button
          >
        </div>

        {#if positions.length > 0}
          <div class="pos-table">
            <div class="pos-head">
              <span>Ziffer</span>
              <span>Kat.</span>
              <span>Beschreibung</span>
              <span class="num">Faktor</span>
              <span class="num">Basis (€)</span>
              <span class="num">Betrag (€)</span>
              <span></span>
            </div>
            {#each positions as pos, i (i)}
              <div class="pos-row">
                <input type="text" bind:value={pos.goae_number} placeholder="z.B. 1" required />
                <select bind:value={pos.goae_category}>
                  {#each goaeCategoryValues as cat (cat)}
                    <option value={cat}>{cat}</option>
                  {/each}
                </select>
                <input type="text" bind:value={pos.description} placeholder="optional" />
                <input
                  class="num"
                  type="number"
                  bind:value={pos.multiplier}
                  min="0.01"
                  step="0.01"
                  required
                />
                <input
                  class="num"
                  type="number"
                  bind:value={pos.base_amount}
                  min="0"
                  step="0.01"
                  required
                />
                <input
                  class="num"
                  type="number"
                  bind:value={pos.charged_amount}
                  min="0"
                  step="0.01"
                  required
                />
                <button
                  type="button"
                  class="btn-icon danger"
                  onclick={() => removePosition(i)}
                  aria-label="Position {i + 1} entfernen"
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

      {#if formError}
        <p class="error" role="alert">{formError}</p>
      {/if}

      <div class="actions">
        <button type="submit" class="btn-primary" disabled={saving}>
          {saving ? 'Wird gespeichert …' : 'Rechnung speichern'}
        </button>
        <a href={resolve('/invoices')} class="btn-secondary">Abbrechen</a>
      </div>
    </form>
  {/if}
</section>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  h1 {
    margin: 0;
  }
  h2 {
    margin: 0;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
  }

  .back-link {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    text-decoration: none;
  }
  .back-link:hover {
    color: var(--color-primary);
  }

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
    grid-template-columns: 5rem 4.5rem 1fr 5rem 7rem 7rem 2rem;
    gap: var(--space-2);
    align-items: center;
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

  .pos-row input,
  .pos-row select {
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font: inherit;
    min-width: 0;
    width: 100%;
  }

  .num {
    text-align: right;
  }
  .pos-row input.num {
    text-align: right;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }

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
  }
  .btn-secondary:hover {
    background: var(--color-bg);
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
  .btn-icon.danger:hover {
    color: var(--color-danger);
    background: color-mix(in srgb, var(--color-danger) 10%, white);
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

  .empty-notice {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-8);
    color: var(--color-text-muted);
    text-align: center;
  }
</style>
