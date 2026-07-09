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
  import { computeSelbstbehaltRadar, currentLeistungsjahr } from '$lib/utils/selbstbehalt-radar';
  import BRETracker from '$lib/components/BRETracker.svelte';
  import SelbstbehaltRadar from '$lib/components/SelbstbehaltRadar.svelte';
  import GCPCard from '$lib/components/GCPCard.svelte';
  import InvoiceList from '$lib/components/InvoiceList.svelte';
  import LoadingState from '$lib/components/LoadingState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Separator } from '$lib/components/ui/separator';
  import { setBreadcrumbEntity } from '$lib/stores/breadcrumb';

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

  // Feed the real tariff name into the global breadcrumb once it has loaded.
  $effect(() => {
    if (insuredPerson) {
      setBreadcrumbEntity(
        insuredId,
        insuredPerson.tariff_name ?? insuredPerson.kvnr ?? 'Versicherte Person',
      );
    }
  });

  // ---------------------------------------------------------------------------
  // Günstigerprüfung per Leistungsjahr (aggregated over all invoices)
  // ---------------------------------------------------------------------------

  interface YearVerdict {
    year: number;
    R_Y: number;
    alreadyBroken: boolean;
    gcp: GCP_Result | null;
  }

  // Positions rolled up per Leistungsjahr (design §5.2.1) — the single source shared
  // by the per-year verdicts and the current-year radar (no double aggregation).
  const aggregates = $derived(
    insuredPerson
      ? aggregateByYear(invoices.map((inv) => ({ status: inv.status, positions: inv.positions })))
      : [],
  );

  // Forward-looking Selbstbehalt/Einreich-Ampel for the current Leistungsjahr (#234).
  const currentRadar = $derived.by(() => {
    if (!insuredPerson) return null;
    const year = currentLeistungsjahr();
    const agg = aggregates.find((a) => a.year === year);
    return computeSelbstbehaltRadar({
      year,
      R_Y: agg?.R_Y ?? 0,
      alreadyReimbursed: agg?.alreadyReimbursed ?? 0,
      selbstbehalt: insuredPerson.self_retention,
      breStructure: insuredPerson.bre_structure ?? null,
      monthlyPremium: insuredPerson.monthly_premium,
      discountRate: $settings.discountRate,
      claimFreeProbability: $settings.claimFreeProbability,
    });
  });

  const yearVerdicts = $derived.by(() => {
    if (!insuredPerson || aggregates.length === 0) return [];
    const sorted = [...aggregates].sort((a, b) => b.year - a.year); // most recent first

    // The streak is broken only once realised reimbursements exceed the deductible.
    const selbstbehalt = insuredPerson.self_retention;

    if (!insuredPerson.bre_structure) {
      return sorted.map(({ year, R_Y, alreadyReimbursed }): YearVerdict => ({
        year,
        R_Y,
        alreadyBroken: alreadyReimbursed > selbstbehalt,
        gcp: null,
      }));
    }

    return sorted.map(({ year, R_Y, alreadyReimbursed }): YearVerdict => {
      const alreadyBroken = alreadyReimbursed > selbstbehalt;
      try {
        const gcp = calculateGCP({
          year,
          erstattungsBetrag: R_Y,
          alreadyReimbursed,
          selbstbehalt,
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
    <h1 class="text-2xl font-bold tracking-tight">
      {insuredPerson.tariff_name ?? insuredPerson.kvnr ?? 'Versicherte Person'}
    </h1>

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
      {#if contract}
        <span class="text-muted-foreground">
          Versicherer:
          <a
            href={resolve('/contracts/[id]', { id: contract.id })}
            class="font-medium text-foreground hover:text-primary hover:underline"
          >
            {contract.insurer_name}
          </a>
        </span>
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

    <!-- Selbstbehalt-Ausschöpfung & Einreich-Ampel für das laufende Leistungsjahr (issue #234) -->
    {#if currentRadar}
      <section class="space-y-2">
        <h2 class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Selbstbehalt-Ausschöpfung {currentRadar.year}
        </h2>
        <SelbstbehaltRadar radar={currentRadar} compact />
      </section>

      <Separator />
    {/if}

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

    <!-- Invoice list — the same component the Rechnungsarchiv uses, scoped to
         this insured person (no Person filter since it is a single person). -->
    <section class="space-y-4">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <h2 class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Rechnungen
        </h2>
        <Button size="sm" href={resolve('/invoices/new')}>+ Neue Rechnung</Button>
      </div>

      <InvoiceList {invoices} newInvoiceHref={resolve('/invoices/new')} />
    </section>
  {/if}
</div>
