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
    formatDate,
    formatEur,
    invoiceStatusValues,
    type Invoice,
    type InvoiceStatus,
  } from '@selbstbehalt/shared';
  import InvoiceBadge from '$lib/components/InvoiceBadge.svelte';
  import LoadingState from '$lib/components/LoadingState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from '$lib/components/ui/table';

  const STATUS_LABELS: Record<InvoiceStatus, string> = {
    neu: 'Neu',
    geprüft: 'Geprüft',
    bezahlt: 'Bezahlt',
    eingereicht: 'Eingereicht',
    erstattet: 'Erstattet',
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

<div class="container mx-auto max-w-5xl px-4 py-8 space-y-6">
  <div class="flex items-center justify-between flex-wrap gap-3">
    <h1 class="text-2xl font-bold tracking-tight">Rechnungen</h1>
    <Button href={resolve('/invoices/new')}>Rechnung erfassen</Button>
  </div>

  {#if loading}
    <LoadingState label="Rechnungen werden geladen …" />
  {:else if error}
    <ErrorState title="Fehler beim Laden" message={error} onRetry={load} />
  {:else}
    <div class="flex flex-wrap gap-4 p-4 rounded-md border border-border bg-card">
      <div class="flex flex-col gap-1">
        <label class="text-xs text-muted-foreground font-medium" for="status-filter">Status</label>
        <select
          id="status-filter"
          bind:value={statusFilter}
          class="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">Alle</option>
          {#each invoiceStatusValues as s (s)}
            <option value={s}>{STATUS_LABELS[s]}</option>
          {/each}
        </select>
      </div>

      <div class="flex flex-col gap-1 flex-1 min-w-56">
        <label class="text-xs text-muted-foreground font-medium" for="search">Suche</label>
        <Input
          id="search"
          type="search"
          bind:value={searchQuery}
          placeholder="Leistungserbringer, Rechnungsnummer …"
        />
      </div>
    </div>

    {#if filtered.length === 0}
      {#if invoices.length === 0}
        <EmptyState message="Noch keine Rechnungen vorhanden.">
          {#snippet action()}
            <Button href={resolve('/invoices/new')}>Erste Rechnung erfassen</Button>
          {/snippet}
        </EmptyState>
      {:else}
        <EmptyState message="Keine Rechnungen entsprechen dem Filter." />
      {/if}
    {:else}
      <div class="rounded-md border border-border shadow-sm overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Datum</TableHead>
              <TableHead>Leistungserbringer</TableHead>
              <TableHead class="text-right">Betrag</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {#each filtered as invoice (invoice.id)}
              <TableRow class="hover:bg-muted/50">
                <TableCell class="text-muted-foreground text-sm"
                  >{formatDate(invoice.invoice_date)}</TableCell
                >
                <TableCell>
                  <div class="flex flex-col gap-0.5">
                    <span>{invoice.provider_name}</span>
                    {#if invoice.invoice_number}
                      <small class="text-xs text-muted-foreground"
                        >Nr. {invoice.invoice_number}</small
                      >
                    {/if}
                  </div>
                </TableCell>
                <TableCell class="text-right font-medium tabular-nums"
                  >{formatEur(invoice.total_amount)}</TableCell
                >
                <TableCell><InvoiceBadge status={invoice.status} /></TableCell>
                <TableCell>
                  <a
                    href={resolve('/invoices/[id]', { id: invoice.id })}
                    class="text-sm text-primary font-medium hover:underline whitespace-nowrap no-underline"
                  >
                    Details →
                  </a>
                </TableCell>
              </TableRow>
            {/each}
          </TableBody>
        </Table>
      </div>

      <p class="text-sm text-muted-foreground text-right">
        {filtered.length} Rechnung{filtered.length === 1 ? '' : 'en'} · Gesamt: {formatEur(
          filtered.reduce((s, i) => s + i.total_amount, 0),
        )}
      </p>
    {/if}
  {/if}
</div>
