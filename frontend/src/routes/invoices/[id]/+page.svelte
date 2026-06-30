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
  import { calculateGCP, type GCP_Result } from '$lib/utils/guenstiger-pruefung';
  import InvoiceBadge from '$lib/components/InvoiceBadge.svelte';
  import GCPCard from '$lib/components/GCPCard.svelte';
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

      // Compute year-based Günstigerprüfung for this invoice's service year.
      // Uses invoice_date year as a proxy for service year; treatment_date aggregation
      // across all invoices of the person is implemented in the Person×Year view (Issue 5/5).
      if (inv.eligible_amount != null && ip.bre_structure) {
        const year = inv.invoice_date
          ? parseInt(inv.invoice_date.substring(0, 4), 10)
          : new Date().getFullYear();

        const allInvoices = await api.invoices.list();
        const relatedInvoices = allInvoices.filter(
          (i) =>
            i.insured_person_id === ip.id &&
            i.invoice_date?.startsWith(String(year)) &&
            i.status !== 'neu',
        );
        const R_Y = roundCents(
          relatedInvoices.reduce((sum, i) => sum + (i.eligible_amount ?? 0), 0),
        );
        const alreadyBroken = relatedInvoices.some(
          (i) => i.status === 'erstattet' && i.total_amount - i.self_paid_amount > 0,
        );

        gcpResult = calculateGCP({
          year,
          erstattungsBetrag: R_Y,
          alreadyBroken,
          selbstbehalt: ip.self_retention,
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
      await api.invoices.changeStatus(invoice.id, { status: 'bezahlt' });
      invoice = await api.invoices.get(invoice.id);
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

<div class="container mx-auto max-w-5xl px-4 py-8 space-y-6">
  <h1 class="text-2xl font-bold tracking-tight">
    {invoice?.provider_name ?? 'Rechnungsdetail'}
  </h1>

  {#if loading}
    <LoadingState label="Rechnungsdaten werden geladen …" />
  {:else if loadError}
    <ErrorState title="Fehler" message={loadError} onRetry={load} />
  {:else if invoice}
    <!-- Header -->
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
        {#if invoice.status === 'bezahlt'}
          <Button size="sm" href={resolve('/invoices/[id]/submit', { id: invoice.id })}>
            Einreichung erfassen
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

    <!-- Summary -->
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
            <CardDescription>Versichert bei</CardDescription>
          </CardHeader>
          <CardContent>
            <p class="text-lg font-semibold">
              {insuredPerson.tariff_name ?? insuredPerson.kvnr ?? 'Unbekannt'}
            </p>
          </CardContent>
        </Card>
      {/if}
    </div>

    {#if invoice.notes}
      <p class="text-sm text-muted-foreground">{invoice.notes}</p>
    {/if}

    <!-- Günstigerprüfung -->
    {#if gcpResult}
      <div class="space-y-2">
        <h2 class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Günstigerprüfung
        </h2>
        <GCPCard
          result={gcpResult}
          onSubmit={goToSubmit}
          onSelfPay={invoice.status !== 'bezahlt' ? markSelfPay : undefined}
          loading={actioning}
        />
        {#if actionError}
          <Alert variant="destructive">
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        {/if}
      </div>
    {:else if invoice.eligible_amount == null}
      <div
        class="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
      >
        Kein erstattungsfähiger Betrag angegeben — Günstigerprüfung nicht möglich.
      </div>
    {:else if insuredPerson && !insuredPerson.bre_structure}
      <div
        class="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
      >
        Keine BRE-Staffel für diese versicherte Person konfiguriert — Günstigerprüfung nicht
        möglich.
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
                <TableHead>Ziffer</TableHead>
                <TableHead>Beschreibung</TableHead>
                <TableHead class="text-right">Faktor</TableHead>
                <TableHead class="text-right">Betrag</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {#each invoice.positions as pos (pos.id)}
                <TableRow
                  class={pos.is_valid === false ? 'bg-yellow-50 dark:bg-yellow-950/20' : ''}
                >
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
                </TableRow>
              {/each}
              <TableRow class="bg-muted/30 font-semibold border-t-2">
                <TableCell></TableCell>
                <TableCell></TableCell>
                <TableCell class="text-right text-muted-foreground">Gesamt</TableCell>
                <TableCell class="text-right tabular-nums">
                  {formatEur(invoice.positions.reduce((s, p) => s + p.charged_amount, 0))}
                </TableCell>
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
