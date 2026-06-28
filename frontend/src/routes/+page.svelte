<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Dashboard (docs/design.md §6.1, issue #23): overview of open invoices,
  pending actions, year stats and per-person BRE status.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { api } from '$lib/api';
  import { formatEur, type InsuredPerson, type Invoice } from '@selbstbehalt/shared';
  import BRETracker from '$lib/components/BRETracker.svelte';
  import InvoiceBadge from '$lib/components/InvoiceBadge.svelte';
  import LoadingState from '$lib/components/LoadingState.svelte';

  // ---- State ----
  let invoices = $state<Invoice[]>([]);
  let insuredPersons = $state<InsuredPerson[]>([]);
  let contractCount = $state(0);
  let totalAmount = $state(0);
  let eligibleAmount = $state(0);
  let loading = $state(true);
  let hasError = $state(false);

  const openInvoices = $derived(
    invoices.filter((i) => i.status === 'neu' || i.status === 'geprüft'),
  );
  const pendingSubmissions = $derived(invoices.filter((i) => i.status === 'eingereicht'));
  const year = new Date().getFullYear();

  async function load() {
    loading = true;
    hasError = false;
    try {
      const [contracts, invs] = await Promise.all([
        api.contracts.list().catch(() => []),
        api.invoices.list().catch(() => []),
      ]);

      contractCount = contracts.length;
      invoices = invs;

      // Year stats from invoices
      const yearInvoices = invs.filter((i) => i.invoice_date?.startsWith(String(year)));
      totalAmount = yearInvoices.reduce((s, i) => s + i.total_amount, 0);
      eligibleAmount = yearInvoices.reduce((s, i) => s + (i.eligible_amount ?? 0), 0);

      // Load insured persons for BRE tracking
      const personLists = await Promise.all(
        contracts.map((c) => api.insured.list(c.id).catch(() => [])),
      );
      insuredPersons = personLists.flat();
    } catch {
      hasError = true;
    } finally {
      loading = false;
    }
  }

  onMount(load);
</script>

<svelte:head><title>Dashboard · selbstbehalt</title></svelte:head>

<section class="page">
  <div class="page-header">
    <h1>Dashboard</h1>
    <div class="quick-actions">
      <a href={resolve('/invoices/scan')} class="btn-primary">Rechnung scannen</a>
      <a href={resolve('/contracts/new')} class="btn-secondary">Vertrag anlegen</a>
    </div>
  </div>

  {#if loading}
    <LoadingState label="Dashboard wird geladen …" />
  {:else}
    <!-- Stats tiles -->
    <div class="tiles">
      <div class="tile">
        <span class="tile-label">Offene Rechnungen</span>
        <span class="tile-value">{openInvoices.length}</span>
        {#if openInvoices.length > 0}
          <a href={resolve('/invoices')} class="tile-link">Anzeigen →</a>
        {/if}
      </div>

      <div class="tile">
        <span class="tile-label">Ausstehende Einreichungen</span>
        <span class="tile-value">{pendingSubmissions.length}</span>
      </div>

      <div class="tile">
        <span class="tile-label">Rechnungen {year}</span>
        <span class="tile-value"
          >{invoices.filter((i) => i.invoice_date?.startsWith(String(year))).length}</span
        >
        {#if totalAmount > 0}
          <span class="tile-sub">{formatEur(totalAmount)} gesamt</span>
        {/if}
      </div>

      <div class="tile">
        <span class="tile-label">Erstattungsfähig {year}</span>
        <span class="tile-value amount">{formatEur(eligibleAmount)}</span>
      </div>

      <div class="tile">
        <span class="tile-label">Verträge</span>
        <span class="tile-value">{contractCount}</span>
        <a href={resolve('/contracts')} class="tile-link">Verwalten →</a>
      </div>
    </div>

    <!-- Open invoices -->
    {#if openInvoices.length > 0}
      <div class="section">
        <h2>Offene Rechnungen</h2>
        <div class="invoice-list">
          {#each openInvoices.slice(0, 5) as invoice (invoice.id)}
            <a href={resolve('/invoices/[id]', { id: invoice.id })} class="invoice-row">
              <span class="inv-date">{invoice.invoice_date}</span>
              <span class="inv-provider">{invoice.provider_name}</span>
              <span class="inv-amount">{formatEur(invoice.total_amount)}</span>
              <InvoiceBadge status={invoice.status} />
            </a>
          {/each}
          {#if openInvoices.length > 5}
            <a href={resolve('/invoices')} class="more-link">
              + {openInvoices.length - 5} weitere →
            </a>
          {/if}
        </div>
      </div>
    {/if}

    <!-- BRE status -->
    {#if insuredPersons.length > 0}
      <div class="section">
        <h2>BRE-Status</h2>
        <div class="bre-grid">
          {#each insuredPersons as ip (ip.id)}
            <BRETracker insuredPerson={ip} compact={true} />
          {/each}
        </div>
      </div>
    {:else if contractCount === 0}
      <div class="empty-state">
        <p>Noch keine Verträge angelegt.</p>
        <a href={resolve('/contracts/new')} class="btn-primary">Ersten Vertrag anlegen</a>
      </div>
    {/if}

    {#if hasError}
      <p class="error-notice">Einige Daten konnten nicht geladen werden.</p>
    {/if}
  {/if}
</section>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  h1 {
    margin: 0;
  }
  h2 {
    margin: 0 0 var(--space-3);
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted);
  }

  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  .quick-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    gap: var(--space-3);
  }

  .tile {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-4);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
  }

  .tile-label {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .tile-value {
    font-size: var(--font-size-xl);
    font-weight: 700;
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

  .tile-value.amount {
    font-size: var(--font-size-lg);
  }

  .tile-sub {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .tile-link {
    font-size: var(--font-size-sm);
    color: var(--color-primary);
    text-decoration: none;
    font-weight: 500;
    margin-top: auto;
  }
  .tile-link:hover {
    text-decoration: underline;
  }

  .section {
    display: flex;
    flex-direction: column;
  }

  .invoice-list {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
    box-shadow: var(--shadow-sm);
  }

  .invoice-row {
    display: grid;
    grid-template-columns: 7rem 1fr 8rem auto;
    gap: var(--space-2);
    align-items: center;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border);
    text-decoration: none;
    color: inherit;
    font-size: var(--font-size-sm);
  }
  .invoice-row:last-of-type {
    border-bottom: none;
  }
  .invoice-row:hover {
    background: var(--color-bg);
  }

  .inv-date {
    color: var(--color-text-muted);
  }
  .inv-amount {
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }

  .more-link {
    display: block;
    padding: var(--space-2) var(--space-4);
    text-align: center;
    font-size: var(--font-size-sm);
    color: var(--color-primary);
    text-decoration: none;
    border-top: 1px solid var(--color-border);
    background: var(--color-bg);
  }
  .more-link:hover {
    text-decoration: underline;
  }

  .bre-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
    gap: var(--space-3);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-8);
    text-align: center;
    color: var(--color-text-muted);
  }

  .error-notice {
    font-size: var(--font-size-sm);
    color: var(--color-warning);
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
