<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Versicherte Person — Detailansicht (docs/design.md §6.1, issue #134):
  Zentraler Knoten für eine versicherte Person: KVNR, Tarif, Selbstbehalt,
  BRE-Staffel, Günstigerprüfungs-Verdikt je Leistungsjahr und Rechnungsliste.
-->
<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { api, ApiError } from '$lib/api';
  import {
    formatDate,
    formatEur,
    type Contract,
    type InsuredPerson,
    type InvoiceWithPositions,
    type Person,
  } from '@selbstbehalt/shared';
  import { settings } from '$lib/stores/settings';
  import { aggregateByYear, calculateGCP, type GCP_Result } from '$lib/utils/guenstiger-pruefung';
  import BRETracker from '$lib/components/BRETracker.svelte';
  import GCPCard from '$lib/components/GCPCard.svelte';
  import InvoiceBadge from '$lib/components/InvoiceBadge.svelte';
  import LoadingState from '$lib/components/LoadingState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent } from '$lib/components/ui/card';
  import { Separator } from '$lib/components/ui/separator';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';

  const insuredId = $derived(page.params.id as string);

  let insuredPerson = $state<InsuredPerson | null>(null);
  let contract = $state<Contract | null>(null);
  let policyholder = $state<Person | null>(null);
  let invoices = $state<InvoiceWithPositions[]>([]);
  let loading = $state(true);
  let loadError = $state<string | null>(null);

  async function load() {
    loading = true;
    loadError = null;
    try {
      const ip = await api.insured.get(insuredId);
      insuredPerson = ip;

      const [c, persons, invList] = await Promise.all([
        api.contracts.get(ip.contract_id),
        api.persons.list(),
        api.invoices.list({ insured_person_id: ip.id }),
      ]);
      contract = c;
      policyholder = persons.find((p) => p.id === c.policyholder_id) ?? null;

      // Load full invoice details (with positions) for GCP aggregation.
      invoices = await Promise.all(invList.map((inv) => api.invoices.get(inv.id)));
    } catch (e) {
      loadError = e instanceof ApiError || e instanceof Error ? e.message : 'Laden fehlgeschlagen.';
    } finally {
      loading = false;
    }
  }

  onMount(load);

  // ---------------------------------------------------------------------------
  // Günstigerprüfung per Leistungsjahr (aggregated over all invoices)
  // ---------------------------------------------------------------------------

  interface YearVerdict {
    year: number;
    R_Y: number;
    alreadyBroken: boolean;
    gcp: GCP_Result | null;
  }

  const yearVerdicts = $derived.by(() => {
    if (!insuredPerson || invoices.length === 0) return [];
    const aggregates = aggregateByYear(
      invoices.map((inv) => ({
        status: inv.status,
        positions: inv.positions,
      })),
    ).sort((a, b) => b.year - a.year); // most recent first

    if (!insuredPerson.bre_structure) {
      return aggregates.map(({ year, R_Y, alreadyBroken }): YearVerdict => ({
        year,
        R_Y,
        alreadyBroken,
        gcp: null,
      }));
    }

    return aggregates.map(({ year, R_Y, alreadyBroken }): YearVerdict => {
      try {
        const gcp = calculateGCP({
          year,
          erstattungsBetrag: R_Y,
          alreadyBroken,
          selbstbehalt: insuredPerson!.self_retention,
          breStructure: insuredPerson!.bre_structure!,
          monthlyPremium: insuredPerson!.monthly_premium,
          discountRate: $settings.discountRate,
          claimFreeProbability: $settings.claimFreeProbability,
        });
        return { year, R_Y, alreadyBroken, gcp };
      } catch {
        return { year, R_Y, alreadyBroken, gcp: null };
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Invoice grouping by year for the invoice list section
  // ---------------------------------------------------------------------------

  const invoicesByYear = $derived.by(() => {
    const map = new SvelteMap<number, InvoiceWithPositions[]>();
    for (const inv of [...invoices].sort((a, b) =>
      (b.invoice_date ?? '').localeCompare(a.invoice_date ?? ''),
    )) {
      const year = inv.invoice_date ? parseInt(inv.invoice_date.substring(0, 4), 10) : 0;
      const list = map.get(year) ?? [];
      list.push(inv);
      map.set(year, list);
    }
    return Array.from(map.entries()).sort((a, b) => b[0] - a[0]);
  });
</script>

<svelte:head>
  <title>
    {insuredPerson
      ? `${insuredPerson.tariff_name ?? insuredPerson.kvnr ?? 'Versicherte Person'} · Versicherte`
      : 'Versicherte Person'} · selbstbehalt
  </title>
</svelte:head>

<div class="container mx-auto max-w-5xl px-4 py-8 space-y-6">
  {#if loading}
    <LoadingState label="Daten werden geladen …" />
  {:else if loadError}
    <ErrorState title="Fehler" message={loadError} onRetry={load} />
  {:else if insuredPerson}
    <!-- Header -->
    <div class="space-y-1">
      <div class="flex items-center gap-2 text-sm text-muted-foreground">
        {#if contract}
          <a href={resolve('/contracts/[id]', { id: contract.id })} class="hover:underline">
            {contract.insurer_name}
          </a>
          <ArrowRightIcon class="size-3.5 shrink-0" />
        {/if}
        <span>Versicherte Person</span>
      </div>
      <h1 class="text-2xl font-bold tracking-tight">
        {insuredPerson.tariff_name ?? insuredPerson.kvnr ?? 'Versicherte Person'}
      </h1>
    </div>

    <!-- Key facts -->
    <div class="flex flex-wrap gap-3 text-sm">
      {#if insuredPerson.kvnr}
        <Badge variant="secondary">KVNR: {insuredPerson.kvnr}</Badge>
      {/if}
      <Badge variant="outline">{formatEur(insuredPerson.monthly_premium)} / Monat</Badge>
      {#if insuredPerson.self_retention > 0}
        <Badge variant="outline"
          >Selbstbehalt: {formatEur(insuredPerson.self_retention)} / Jahr</Badge
        >
      {/if}
      {#if policyholder}
        <span class="text-muted-foreground">
          Versicherungsnehmer: <strong class="text-foreground">{policyholder.name}</strong>
        </span>
      {/if}
      {#if insuredPerson.start_date}
        <span class="text-muted-foreground">
          seit {formatDate(insuredPerson.start_date)}{insuredPerson.end_date
            ? ` bis ${formatDate(insuredPerson.end_date)}`
            : ''}
        </span>
      {/if}
    </div>

    {#if insuredPerson.notes}
      <p class="text-sm text-muted-foreground">{insuredPerson.notes}</p>
    {/if}

    <!-- BRE tracker -->
    <section class="space-y-2">
      <h2 class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        BRE-Staffel
      </h2>
      <BRETracker {insuredPerson} />
    </section>

    <Separator />

    <!-- Günstigerprüfung verdicts per service year -->
    {#if yearVerdicts.length > 0}
      <section class="space-y-4">
        <h2 class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Günstigerprüfung je Leistungsjahr
        </h2>

        {#each yearVerdicts as verdict (verdict.year)}
          <div class="space-y-2">
            <div class="flex items-center justify-between gap-3">
              <h3 class="text-base font-semibold">{verdict.year}</h3>
              <div class="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Gesamt: {formatEur(verdict.R_Y)}</span>
                {#if verdict.alreadyBroken}
                  <Badge
                    variant="outline"
                    class="border-amber-500/60 text-amber-700 dark:text-amber-400"
                    >Staffel gebrochen</Badge
                  >
                {/if}
              </div>
            </div>

            {#if verdict.gcp}
              <GCPCard result={verdict.gcp} />
            {:else if !insuredPerson.bre_structure}
              <div
                class="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
              >
                Keine BRE-Staffel konfiguriert — Günstigerprüfung nicht möglich.
                <a
                  href={resolve('/contracts/[id]', { id: insuredPerson.contract_id })}
                  class="ml-1 underline"
                >
                  Im Vertrag konfigurieren.
                </a>
              </div>
            {/if}
          </div>
        {/each}
      </section>

      <Separator />
    {/if}

    <!-- Invoice list grouped by year -->
    <section class="space-y-4">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <h2 class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Rechnungen
        </h2>
        <Button size="sm" href={resolve('/invoices/new')}>+ Neue Rechnung</Button>
      </div>

      {#if invoices.length === 0}
        <p class="text-sm text-muted-foreground">Noch keine Rechnungen vorhanden.</p>
      {:else}
        {#each invoicesByYear as [year, yearInvoices] (year)}
          <div class="space-y-2">
            <p class="text-sm font-medium text-muted-foreground">{year || '—'}</p>
            <Card>
              <CardContent class="p-0">
                {#each yearInvoices as inv, i (inv.id)}
                  {#if i > 0}
                    <Separator />
                  {/if}
                  <a
                    href={resolve('/invoices/[id]', { id: inv.id })}
                    class="flex items-center justify-between gap-3 px-4 py-3 no-underline hover:bg-muted/50 transition-colors rounded-md group"
                  >
                    <div class="flex flex-col gap-0.5 min-w-0">
                      <span
                        class="font-medium text-sm group-hover:text-primary transition-colors truncate"
                      >
                        {inv.provider_name}
                      </span>
                      <span class="text-xs text-muted-foreground"
                        >{formatDate(inv.invoice_date)}</span
                      >
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      <InvoiceBadge status={inv.status} />
                      <span class="text-sm font-semibold tabular-nums"
                        >{formatEur(inv.total_amount)}</span
                      >
                    </div>
                  </a>
                {/each}
              </CardContent>
            </Card>
          </div>
        {/each}
      {/if}
    </section>
  {/if}
</div>
