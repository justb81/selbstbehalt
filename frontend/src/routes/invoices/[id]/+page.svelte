<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Rechnungsdetail (docs/design.md §6.1, issue #22, issue #134, issue #142): invoice with
  positions, §5-validation flags, GCPContributionCard (marginal contribution per service year),
  and the full status-workflow card (InvoiceStatusFlow).
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { api, ApiError } from '$lib/api';
  import {
    formatEur,
    roundCents,
    type InsuredPerson,
    type InvoiceWithPositions,
  } from '@selbstbehalt/shared';
  import { aggregateByYear } from '$lib/utils/guenstiger-pruefung';
  import InvoiceBadge from '$lib/components/InvoiceBadge.svelte';
  import InvoiceStatusFlow from '$lib/components/InvoiceStatusFlow.svelte';
  import GCPContributionCard from '$lib/components/GCPContributionCard.svelte';
  import LoadingState from '$lib/components/LoadingState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from '$lib/components/ui/table';

  const invoiceId = $derived(page.params.id as string);

  let invoice = $state<InvoiceWithPositions | null>(null);
  let insuredPerson = $state<InsuredPerson | null>(null);
  let allPersonInvoices = $state<InvoiceWithPositions[]>([]);
  let loading = $state(true);
  let loadError = $state<string | null>(null);

  async function load() {
    loading = true;
    loadError = null;
    try {
      const inv = await api.invoices.get(invoiceId);
      invoice = inv;

      const ip = await api.insured.get(inv.insured_person_id);
      insuredPerson = ip;

      // Load all invoices for this person to compute accurate total R_Y per service year.
      const invList = await api.invoices.list({ insured_person_id: ip.id });
      allPersonInvoices = await Promise.all(invList.map((i) => api.invoices.get(i.id)));
    } catch (e) {
      loadError = e instanceof ApiError || e instanceof Error ? e.message : 'Laden fehlgeschlagen.';
    } finally {
      loading = false;
    }
  }

  onMount(load);

  // ---------------------------------------------------------------------------
  // Contribution of this invoice's positions per service year
  // ---------------------------------------------------------------------------

  interface YearContribution {
    year: number;
    amount: number;
    totalR_Y: number;
    selbstbehalt: number;
    alreadyBroken: boolean;
  }

  const contributions = $derived.by((): YearContribution[] => {
    if (!invoice || !insuredPerson || invoice.status === 'neu') return [];

    // Aggregate R_Y over all invoices of this person.
    const allAggregates = new Map(
      aggregateByYear(
        allPersonInvoices.map((inv) => ({ status: inv.status, positions: inv.positions })),
      ).map((a) => [a.year, a]),
    );

    // Aggregate this invoice's positions by service year.
    const byYear = new SvelteMap<number, number>();
    for (const pos of invoice.positions) {
      if (!pos.treatment_date) continue;
      const year = parseInt(pos.treatment_date.substring(0, 4), 10);
      const amount =
        invoice.status === 'erstattet' ? (pos.refund_amount ?? 0) : (pos.eligible_amount ?? 0);
      byYear.set(year, (byYear.get(year) ?? 0) + amount);
    }

    return Array.from(byYear.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([year, amount]) => {
        const agg = allAggregates.get(year);
        return {
          year,
          amount: roundCents(amount),
          totalR_Y: agg?.R_Y ?? roundCents(amount),
          selbstbehalt: insuredPerson!.self_retention,
          alreadyBroken: agg?.alreadyBroken ?? false,
        };
      });
  });

  let deletingInvoice = $state(false);
  let confirmDeleteInvoice = $state(false);
  let deleteError = $state<string | null>(null);

  async function deleteInvoice() {
    if (!invoice) return;
    deletingInvoice = true;
    try {
      await api.invoices.remove(invoice.id);
      await goto(resolve('/invoices'));
    } catch (e) {
      deleteError =
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

<div class="container mx-auto max-w-5xl px-4 py-8 space-y-6">
  <h1 class="text-2xl font-bold tracking-tight">
    {invoice?.provider_name ?? 'Rechnungsdetail'}
  </h1>

  {#if loading}
    <LoadingState label="Rechnungsdaten werden geladen …" />
  {:else if loadError}
    <ErrorState title="Fehler" message={loadError} onRetry={load} />
  {:else if invoice}
    <!-- Header: date, number, badge and quick-access buttons -->
    <div class="flex items-start justify-between gap-4 flex-wrap">
      <div class="flex items-center gap-3 flex-wrap text-sm text-muted-foreground mt-1">
        <span>{invoice.invoice_date}</span>
        {#if invoice.invoice_number}<span>Nr. {invoice.invoice_number}</span>{/if}
        <InvoiceBadge status={invoice.status} />
      </div>
      <div class="flex gap-2 flex-wrap items-start">
        {#if invoice.status === 'neu' || invoice.status === 'geprüft'}
          <Button
            variant="outline"
            size="sm"
            href={resolve('/invoices/[id]/edit', { id: invoice.id })}
          >
            Bearbeiten
          </Button>
        {/if}
        <Button
          variant="outline"
          size="sm"
          class="border-destructive text-destructive hover:bg-destructive/10"
          onclick={() => {
            confirmDeleteInvoice = true;
          }}
        >
          Löschen
        </Button>
      </div>
    </div>

    <!-- Summary cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <CardHeader class="pb-2">
          <CardDescription>Gesamtbetrag</CardDescription>
        </CardHeader>
        <CardContent>
          <p class="text-lg font-semibold tabular-nums">{formatEur(invoice.total_amount)}</p>
        </CardContent>
      </Card>
      {#if invoice.eligible_amount != null}
        <Card>
          <CardHeader class="pb-2">
            <CardDescription>Erstattungsfähig</CardDescription>
          </CardHeader>
          <CardContent>
            <p class="text-lg font-semibold tabular-nums">{formatEur(invoice.eligible_amount)}</p>
          </CardContent>
        </Card>
      {/if}
      {#if invoice.self_paid_amount > 0}
        <Card>
          <CardHeader class="pb-2">
            <CardDescription>Selbst gezahlt</CardDescription>
          </CardHeader>
          <CardContent>
            <p class="text-lg font-semibold tabular-nums">{formatEur(invoice.self_paid_amount)}</p>
          </CardContent>
        </Card>
      {/if}
      {#if insuredPerson}
        <Card>
          <CardHeader class="pb-2">
            <CardDescription>Versicherte Person</CardDescription>
          </CardHeader>
          <CardContent>
            <a
              href={resolve('/insured/[id]', { id: insuredPerson.id })}
              class="text-lg font-semibold hover:text-primary hover:underline transition-colors"
            >
              {insuredPerson.tariff_name ?? insuredPerson.kvnr ?? 'Unbekannt'}
            </a>
          </CardContent>
        </Card>
      {/if}
    </div>

    {#if invoice.notes}
      <p class="text-sm text-muted-foreground">{invoice.notes}</p>
    {/if}

    <!-- Status workflow: transitions, refund capture, history -->
    <InvoiceStatusFlow {invoice} onChanged={load} />

    <!-- Günstigerprüfung: marginal contribution per service year -->
    {#if contributions.length > 0 && insuredPerson}
      <GCPContributionCard
        {contributions}
        insuredPersonId={insuredPerson.id}
        insuredLabel={insuredPerson.tariff_name ?? insuredPerson.kvnr ?? 'Versicherte Person'}
      />
    {:else if invoice.status === 'neu'}
      <div
        class="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
      >
        Rechnung im Status „neu" — Günstigerprüfung erst nach Prüfung der Positionen möglich.
      </div>
    {:else if invoice.positions.every((p) => !p.treatment_date)}
      <div
        class="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
      >
        Kein Leistungsdatum in den Positionen — Günstigerprüfung nicht möglich.
      </div>
    {/if}

    <!-- Positions -->
    {#if invoice.positions.length > 0}
      <div class="space-y-2">
        <h2 class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Rechnungspositionen
        </h2>
        <div class="rounded-md border border-border shadow-sm overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Datum</TableHead>
                <TableHead>Ziffer</TableHead>
                <TableHead>Beschreibung</TableHead>
                <TableHead class="text-right">Faktor</TableHead>
                <TableHead class="text-right">Betrag</TableHead>
                {#if invoice.positions.some((p) => p.refund_amount != null)}
                  <TableHead class="text-right">Erstattet</TableHead>
                {/if}
              </TableRow>
            </TableHeader>
            <TableBody>
              {#each invoice.positions as pos (pos.id)}
                <TableRow
                  class={pos.is_valid === false ? 'bg-yellow-50 dark:bg-yellow-950/20' : ''}
                >
                  <TableCell class="tabular-nums text-sm">{pos.treatment_date ?? '—'}</TableCell>
                  <TableCell class="font-semibold">{pos.goae_number}</TableCell>
                  <TableCell>
                    <div class="flex flex-col gap-0.5">
                      <span>{pos.description ?? '—'}</span>
                      {#if pos.is_valid === false && pos.flag_reason}
                        <small class="text-yellow-600 dark:text-yellow-400 text-xs"
                          >⚠ {pos.flag_reason}</small
                        >
                      {/if}
                      {#if pos.goae_category}
                        <small class="text-muted-foreground text-xs">{pos.goae_category}</small>
                      {/if}
                    </div>
                  </TableCell>
                  <TableCell class="text-right">{pos.multiplier.toFixed(2)}</TableCell>
                  <TableCell class="text-right tabular-nums"
                    >{formatEur(pos.charged_amount)}</TableCell
                  >
                  {#if invoice.positions.some((p) => p.refund_amount != null)}
                    <TableCell class="text-right tabular-nums">
                      {#if pos.refund_amount != null}
                        {pos.refund_amount === 0 ? 'Abgelehnt' : formatEur(pos.refund_amount)}
                      {:else}
                        —
                      {/if}
                    </TableCell>
                  {/if}
                </TableRow>
              {/each}
              <TableRow class="bg-muted/30 font-semibold border-t-2">
                <TableCell></TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
                <TableCell class="text-right text-muted-foreground">Gesamt</TableCell>
                <TableCell class="text-right tabular-nums">
                  {formatEur(invoice.positions.reduce((s, p) => s + p.charged_amount, 0))}
                </TableCell>
                {#if invoice.positions.some((p) => p.refund_amount != null)}
                  <TableCell class="text-right tabular-nums">
                    {formatEur(invoice.positions.reduce((s, p) => s + (p.refund_amount ?? 0), 0))}
                  </TableCell>
                {/if}
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>
    {/if}

    <!-- Delete confirmation -->
    {#if confirmDeleteInvoice}
      <div
        class="rounded-md border border-destructive/40 bg-destructive/5 p-4 space-y-3"
        role="alertdialog"
      >
        <p class="text-sm">
          Rechnung von <strong>{invoice.provider_name}</strong> wirklich löschen?
        </p>
        {#if deleteError}
          <Alert variant="destructive">
            <AlertDescription>{deleteError}</AlertDescription>
          </Alert>
        {/if}
        <div class="flex flex-wrap gap-2">
          <Button variant="destructive" onclick={deleteInvoice} disabled={deletingInvoice}>
            {deletingInvoice ? 'Wird gelöscht …' : 'Ja, löschen'}
          </Button>
          <Button
            variant="outline"
            onclick={() => {
              confirmDeleteInvoice = false;
            }}>Abbrechen</Button
          >
        </div>
      </div>
    {/if}
  {/if}
</div>
