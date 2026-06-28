<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Rechnungsarchiv (docs/design.md §6.1, issue #22): invoice list with status
  filter, search, and InvoiceBadge. Links to detail and manual-entry form.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { api } from '$lib/api';
  import {
    formatEur,
    invoiceStatusValues,
    type Invoice,
    type InvoiceStatus,
  } from '@selbstbehalt/shared';
  import InvoiceBadge from '$lib/components/InvoiceBadge.svelte';
  import LoadingState from '$lib/components/LoadingState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';

  const STATUS_LABELS: Record<InvoiceStatus, string> = {
    neu: 'Neu',
    geprüft: 'Geprüft',
    eingereicht: 'Eingereicht',
    erstattet: 'Erstattet',
    abgelehnt: 'Abgelehnt',
    selbst_gezahlt: 'Selbst gezahlt',
  };

  let invoices = $state<Invoice[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  let statusFilter = $state<InvoiceStatus | ''>('');
  let searchQuery = $state('');

  const filtered = $derived(
    invoices.filter((inv) => {
      if (statusFilter && inv.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          inv.provider_name.toLowerCase().includes(q) ||
          (inv.invoice_number?.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    }),
  );

  async function load() {
    loading = true;
    error = null;
    try {
      invoices = await api.invoices.list();
    } catch {
      error = 'Rechnungen konnten nicht geladen werden.';
    } finally {
      loading = false;
    }
  }

  onMount(load);
</script>

<svelte:head><title>Rechnungen · selbstbehalt</title></svelte:head>

<section class="page">
  <div class="page-header">
    <h1>Rechnungen</h1>
    <div class="header-actions">
      <a href={resolve('/invoices/new')} class="btn-secondary">Manuell erfassen</a>
      <a href={resolve('/invoices/scan')} class="btn-primary">Rechnung scannen</a>
    </div>
  </div>

  {#if loading}
    <LoadingState label="Rechnungen werden geladen …" />
  {:else if error}
    <ErrorState title="Fehler beim Laden" message={error} onRetry={load} />
  {:else}
    <div class="filters">
      <label class="filter-field">
        <span>Status</span>
        <select bind:value={statusFilter}>
          <option value="">Alle</option>
          {#each invoiceStatusValues as s (s)}
            <option value={s}>{STATUS_LABELS[s]}</option>
          {/each}
        </select>
      </label>

      <label class="filter-field search">
        <span>Suche</span>
        <input
          type="search"
          bind:value={searchQuery}
          placeholder="Leistungserbringer, Rechnungsnummer …"
        />
      </label>
    </div>

    {#if filtered.length === 0}
      <div class="empty">
        {#if invoices.length === 0}
          <p>Noch keine Rechnungen vorhanden.</p>
          <a href={resolve('/invoices/scan')} class="btn-primary">Erste Rechnung scannen</a>
        {:else}
          <p>Keine Rechnungen entsprechen dem Filter.</p>
        {/if}
      </div>
    {:else}
      <div class="invoice-table">
        <div class="table-head">
          <span>Datum</span>
          <span>Leistungserbringer</span>
          <span class="num">Betrag</span>
          <span>Status</span>
          <span></span>
        </div>

        {#each filtered as invoice (invoice.id)}
          <div class="table-row">
            <span class="date">{invoice.invoice_date}</span>
            <span class="provider">
              {invoice.provider_name}
              {#if invoice.invoice_number}
                <small class="inv-num">Nr. {invoice.invoice_number}</small>
              {/if}
            </span>
            <span class="num amount">{formatEur(invoice.total_amount)}</span>
            <span><InvoiceBadge status={invoice.status} /></span>
            <a href={resolve('/invoices/[id]', { id: invoice.id })} class="detail-link">
              Details →
            </a>
          </div>
        {/each}
      </div>

      <p class="total-row">
        {filtered.length} Rechnung{filtered.length === 1 ? '' : 'en'} · Gesamt: {formatEur(
          filtered.reduce((s, i) => s + i.total_amount, 0),
        )}
      </p>
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

  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  .header-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .filter-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .filter-field.search {
    flex: 1;
    min-width: 14rem;
  }

  .filter-field input,
  .filter-field select {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font: inherit;
    background: var(--color-bg);
    color: var(--color-text);
  }

  .invoice-table {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
    box-shadow: var(--shadow-sm);
  }

  .table-head,
  .table-row {
    display: grid;
    grid-template-columns: 7rem 1fr 8rem auto 6rem;
    gap: var(--space-2);
    align-items: center;
    padding: var(--space-3) var(--space-4);
  }

  .table-head {
    background: var(--color-bg);
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--color-text-muted);
    border-bottom: 1px solid var(--color-border);
  }

  .table-row {
    border-bottom: 1px solid var(--color-border);
  }

  .table-row:last-child {
    border-bottom: none;
  }

  .table-row:hover {
    background: var(--color-bg);
  }

  .date {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .provider {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .inv-num {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .num {
    text-align: right;
  }

  .amount {
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  .detail-link {
    color: var(--color-primary);
    text-decoration: none;
    font-size: var(--font-size-sm);
    font-weight: 500;
    white-space: nowrap;
  }

  .detail-link:hover {
    text-decoration: underline;
  }

  .total-row {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    text-align: right;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-8);
    text-align: center;
    color: var(--color-text-muted);
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
    display: inline-flex;
    align-items: center;
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-sm);
    font-weight: 500;
    text-decoration: none;
  }
  .btn-secondary:hover {
    background: var(--color-bg);
  }
</style>
