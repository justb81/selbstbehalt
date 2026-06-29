<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Rechnungsdetail (docs/design.md §6.1, issue #22): invoice with positions,
  §5-validation flags, Günstigerprüfung (GCPCard) and submission link.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import {
    formatEur,
    roundCents,
    type InsuredPerson,
    type InvoiceWithPositions,
  } from '@selbstbehalt/shared';
  import { settings } from '$lib/stores/settings';
  import { calculateGCP } from '$lib/utils/guenstiger-pruefung';
  import type { GCP_Result } from '$lib/utils/guenstiger-pruefung';
  import InvoiceBadge from '$lib/components/InvoiceBadge.svelte';
  import GCPCard from '$lib/components/GCPCard.svelte';
  import LoadingState from '$lib/components/LoadingState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';

  const invoiceId = $derived(page.params.id as string);

  let invoice = $state<InvoiceWithPositions | null>(null);
  let insuredPerson = $state<InsuredPerson | null>(null);
  let gcpResult = $state<GCP_Result | null>(null);
  let loading = $state(true);
  let loadError = $state<string | null>(null);

  async function load() {
    loading = true;
    loadError = null;
    gcpResult = null;
    try {
      const inv = await api.invoices.get(invoiceId);
      invoice = inv;

      const ip = await api.insured.get(inv.insured_person_id);
      insuredPerson = ip;

      // Compute remaining deductible: self_retention - self_paid YTD for this insured person
      if (inv.eligible_amount != null && ip.bre_structure) {
        const year = new Date().getFullYear();
        const allInvoices = await api.invoices.list();
        const selfPaidYtd = allInvoices
          .filter(
            (i) =>
              i.insured_person_id === ip.id &&
              i.invoice_date?.startsWith(String(year)) &&
              i.id !== inv.id,
          )
          .reduce((sum, i) => sum + i.self_paid_amount, 0);

        const verbleibenderSelbstbehalt = roundCents(Math.max(0, ip.self_retention - selfPaidYtd));

        gcpResult = calculateGCP({
          erstattungsBetrag: inv.eligible_amount,
          verbleibenderSelbstbehalt,
          breStructure: ip.bre_structure,
          monthlyPremium: ip.monthly_premium,
          discountRate: $settings.discountRate,
          taxSavingFromSelfPay: 0,
        });
      }
    } catch (e) {
      loadError = e instanceof ApiError || e instanceof Error ? e.message : 'Laden fehlgeschlagen.';
    } finally {
      loading = false;
    }
  }

  onMount(load);

  let actioning = $state(false);
  let actionError = $state<string | null>(null);

  async function markSelfPay() {
    if (!invoice) return;
    actioning = true;
    actionError = null;
    try {
      const updated = await api.invoices.update(invoice.id, {
        status: 'selbst_gezahlt',
        decision: 'selbst_zahlen',
        self_paid_amount: invoice.total_amount,
      });
      invoice = updated;
    } catch (e) {
      actionError =
        e instanceof ApiError || e instanceof Error ? e.message : 'Aktualisierung fehlgeschlagen.';
    } finally {
      actioning = false;
    }
  }

  async function goToSubmit() {
    if (!invoice) return;
    await goto(resolve('/invoices/[id]/submit', { id: invoice.id }));
  }

  let deletingInvoice = $state(false);
  let confirmDeleteInvoice = $state(false);

  async function deleteInvoice() {
    if (!invoice) return;
    deletingInvoice = true;
    try {
      await api.invoices.remove(invoice.id);
      await goto(resolve('/invoices'));
    } catch (e) {
      actionError =
        e instanceof ApiError || e instanceof Error ? e.message : 'Löschen fehlgeschlagen.';
      deletingInvoice = false;
      confirmDeleteInvoice = false;
    }
  }
</script>

<svelte:head>
  <title>
    {invoice ? `${invoice.provider_name} · Rechnung` : 'Rechnungsdetail'} · selbstbehalt
  </title>
</svelte:head>

<section class="page">
  <div class="back-row">
    <a href={resolve('/invoices')} class="back-link">← Rechnungen</a>
  </div>

  <h1 class="page-title">{invoice?.provider_name ?? 'Rechnungsdetail'}</h1>

  {#if loading}
    <LoadingState label="Rechnungsdaten werden geladen …" />
  {:else if loadError}
    <ErrorState title="Fehler" message={loadError} onRetry={load} />
  {:else if invoice}
    <!-- Header -->
    <div class="invoice-header">
      <div>
        <div class="header-meta">
          <span>{invoice.invoice_date}</span>
          {#if invoice.invoice_number}<span>Nr. {invoice.invoice_number}</span>{/if}
          <InvoiceBadge status={invoice.status} />
        </div>
      </div>
      <div class="header-actions">
        {#if invoice.status === 'neu' || invoice.status === 'geprüft' || invoice.status === 'selbst_gezahlt'}
          <a href={resolve('/invoices/[id]/edit', { id: invoice.id })} class="btn-secondary">
            Bearbeiten
          </a>
        {/if}
        {#if invoice.status === 'neu' || invoice.status === 'geprüft'}
          <a href={resolve('/invoices/[id]/submit', { id: invoice.id })} class="btn-primary">
            Einreichung erfassen
          </a>
        {/if}
        <button
          type="button"
          class="btn-danger-outline"
          onclick={() => {
            confirmDeleteInvoice = true;
          }}
        >
          Löschen
        </button>
      </div>
    </div>

    <!-- Summary -->
    <div class="summary-grid">
      <div class="summary-item">
        <span class="summary-label">Gesamtbetrag</span>
        <span class="summary-value">{formatEur(invoice.total_amount)}</span>
      </div>
      {#if invoice.eligible_amount != null}
        <div class="summary-item">
          <span class="summary-label">Erstattungsfähig</span>
          <span class="summary-value">{formatEur(invoice.eligible_amount)}</span>
        </div>
      {/if}
      {#if invoice.self_paid_amount > 0}
        <div class="summary-item">
          <span class="summary-label">Selbst gezahlt</span>
          <span class="summary-value">{formatEur(invoice.self_paid_amount)}</span>
        </div>
      {/if}
      {#if insuredPerson}
        <div class="summary-item">
          <span class="summary-label">Versichert bei</span>
          <span class="summary-value"
            >{insuredPerson.tariff_name ?? insuredPerson.kvnr ?? 'Unbekannt'}</span
          >
        </div>
      {/if}
    </div>

    {#if invoice.notes}
      <p class="notes">{invoice.notes}</p>
    {/if}

    <!-- Günstigerprüfung -->
    {#if gcpResult}
      <div class="section">
        <h2>Günstigerprüfung</h2>
        <GCPCard
          result={gcpResult}
          onSubmit={goToSubmit}
          onSelfPay={invoice.status !== 'selbst_gezahlt' ? markSelfPay : undefined}
          loading={actioning}
        />
        {#if actionError}
          <p class="error" role="alert">{actionError}</p>
        {/if}
      </div>
    {:else if invoice.eligible_amount == null}
      <p class="muted-notice">
        Kein erstattungsfähiger Betrag angegeben — Günstigerprüfung nicht möglich.
      </p>
    {:else if insuredPerson && !insuredPerson.bre_structure}
      <p class="muted-notice">
        Keine BRE-Staffel für diese versicherte Person konfiguriert — Günstigerprüfung nicht
        möglich.
      </p>
    {/if}

    <!-- Positions -->
    {#if invoice.positions.length > 0}
      <div class="section">
        <h2>Rechnungspositionen</h2>
        <div class="positions-table">
          <div class="pos-head">
            <span>Ziffer</span>
            <span>Beschreibung</span>
            <span class="num">Faktor</span>
            <span class="num">Betrag</span>
          </div>
          {#each invoice.positions as pos (pos.id)}
            <div class="pos-row" class:flagged={pos.is_valid === false}>
              <span class="goae-number">{pos.goae_number}</span>
              <span class="description">
                {pos.description ?? '—'}
                {#if pos.is_valid === false && pos.flag_reason}
                  <small class="flag-reason">⚠ {pos.flag_reason}</small>
                {/if}
                {#if pos.goae_category}
                  <small class="category">{pos.goae_category}</small>
                {/if}
              </span>
              <span class="num">{pos.multiplier.toFixed(2)}</span>
              <span class="num amount">{formatEur(pos.charged_amount)}</span>
            </div>
          {/each}
          <div class="pos-total">
            <span></span>
            <span></span>
            <span class="num label">Gesamt</span>
            <span class="num total-amount">
              {formatEur(invoice.positions.reduce((s, p) => s + p.charged_amount, 0))}
            </span>
          </div>
        </div>
      </div>
    {/if}

    <!-- Delete confirmation -->
    {#if confirmDeleteInvoice}
      <div class="confirm-dialog" role="alertdialog">
        <p>Rechnung von <strong>{invoice.provider_name}</strong> wirklich löschen?</p>
        <div class="actions">
          <button
            type="button"
            class="btn-danger"
            onclick={deleteInvoice}
            disabled={deletingInvoice}
          >
            {deletingInvoice ? 'Wird gelöscht …' : 'Ja, löschen'}
          </button>
          <button
            type="button"
            class="btn-secondary"
            onclick={() => {
              confirmDeleteInvoice = false;
            }}
          >
            Abbrechen
          </button>
        </div>
      </div>
    {/if}
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
    margin: 0 0 var(--space-2);
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
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

  .invoice-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .header-meta {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    margin-top: var(--space-1);
  }

  .header-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .summary-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: var(--space-3);
  }

  .summary-item {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .summary-label {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .summary-value {
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

  .notes {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .positions-table {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
    overflow-x: auto;
  }

  .pos-head,
  .pos-row,
  .pos-total {
    display: grid;
    grid-template-columns: 5.5rem 1fr 5.5rem 8rem;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    align-items: start;
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
    font-size: var(--font-size-sm);
  }

  .pos-row.flagged {
    background: color-mix(in srgb, var(--color-warning) 8%, var(--color-surface));
  }

  .pos-total {
    border-top: 2px solid var(--color-border);
    background: var(--color-bg);
    font-weight: 600;
  }

  .goae-number {
    font-weight: 600;
  }

  .description {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .flag-reason {
    color: var(--color-warning);
  }
  .category {
    color: var(--color-text-muted);
  }

  .num {
    text-align: right;
  }
  .amount {
    font-variant-numeric: tabular-nums;
  }
  .total-amount {
    font-variant-numeric: tabular-nums;
    color: var(--color-text);
  }
  .label {
    color: var(--color-text-muted);
  }

  .muted-notice {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    padding: var(--space-3);
    background: var(--color-bg);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    margin: 0;
  }

  .confirm-dialog {
    padding: var(--space-4);
    background: color-mix(in srgb, var(--color-danger) 5%, var(--color-surface));
    border: 1px solid color-mix(in srgb, var(--color-danger) 40%, var(--color-border));
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .confirm-dialog p {
    margin: 0;
    font-size: var(--font-size-sm);
  }

  .actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .error {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
    margin: 0;
  }

  .btn-primary {
    display: inline-flex;
    align-items: center;
    padding: var(--space-2) var(--space-4);
    border: none;
    border-radius: var(--radius-sm);
    background: var(--color-primary);
    color: var(--color-primary-contrast);
    font: inherit;
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
  }
  .btn-primary:hover {
    background: var(--color-primary-strong);
  }

  .btn-secondary {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
  }
  .btn-secondary:hover {
    background: var(--color-bg);
  }

  .btn-danger-outline {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-danger);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-danger);
    font: inherit;
    font-size: var(--font-size-sm);
    font-weight: 500;
    cursor: pointer;
  }
  .btn-danger-outline:hover {
    background: color-mix(in srgb, var(--color-danger) 8%, white);
  }

  .btn-danger {
    padding: var(--space-2) var(--space-4);
    border: none;
    border-radius: var(--radius-sm);
    background: var(--color-danger);
    color: #fff;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
