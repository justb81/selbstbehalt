<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Jahresauswertung (docs/design.md §6.1, issue #28):
  Vollständige Jahresanalyse — Kosten, Erstattungen, BRE-Jahresverlauf.
  Das Dashboard zeigt offene Aktionen und BRE-Schnellstatus; diese Seite liefert
  die detaillierte Jahresanalyse über die Stats-API (#13). Der CSV/PDF-Export
  wurde nach #184 ausgegliedert.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import {
    formatEur,
    type BREHistory,
    type InsuredPerson,
    type PositionYearRollup,
    type YearStats,
  } from '@selbstbehalt/shared';
  import { settings } from '$lib/stores/settings';
  import { computeSelbstbehaltRadar } from '$lib/utils/selbstbehalt-radar';
  import CostsRefundsChart from '$lib/components/CostsRefundsChart.svelte';
  import BreProgressionChart from '$lib/components/BreProgressionChart.svelte';
  import SelbstbehaltRadar from '$lib/components/SelbstbehaltRadar.svelte';
  import LoadingState from '$lib/components/LoadingState.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import { Button } from '$lib/components/ui/button';
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from '$lib/components/ui/card';
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from '$lib/components/ui/select';

  type PersonOption = { id: string; label: string };

  const currentYear = new Date().getFullYear();

  // ---- Base data (contracts, invoices, insured persons) ----
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let hasInvoiceYears = $state(false);
  let personOptions = $state<PersonOption[]>([]);
  let insuredPersons = $state<InsuredPerson[]>([]);
  let positionRollups = $state<PositionYearRollup[]>([]);
  let availableYears = $state<number[]>([currentYear]);

  let selectedYear = $state(currentYear);
  let selectedPersonId = $state('');

  // ---- Year-window costs/refunds chart ----
  let yearStats = $state<YearStats[]>([]);
  let yearStatsLoading = $state(false);
  let yearStatsError = $state<string | null>(null);

  // ---- BRE progression chart ----
  let breHistory = $state<BREHistory | null>(null);
  let breLoading = $state(false);
  let breError = $state<string | null>(null);

  const selectedYearStats = $derived(yearStats.find((y) => y.year === selectedYear) ?? null);

  const yearWindow = $derived.by(() => {
    const minYear = availableYears[0] ?? selectedYear;
    const start = Math.max(minYear, selectedYear - 4);
    const years: number[] = [];
    for (let y = start; y <= selectedYear; y++) years.push(y);
    return years;
  });

  async function loadBase() {
    loading = true;
    loadError = null;
    try {
      const [contracts, invoices] = await Promise.all([api.contracts.list(), api.invoices.list()]);

      const invoiceYears = invoices
        .map((invoice) => (invoice.invoice_date ? Number(invoice.invoice_date.slice(0, 4)) : NaN))
        .filter((year) => Number.isInteger(year));
      availableYears = Array.from(new Set([currentYear, ...invoiceYears])).sort((a, b) => a - b);
      hasInvoiceYears = invoices.length > 0;

      const personLists = await Promise.all(
        contracts.map(async (contract) => {
          const persons = await api.insured.list(contract.id);
          return persons.map((person: InsuredPerson) => ({
            person,
            label: `${contract.insurer_name} · ${person.tariff_name ?? person.kvnr ?? 'Tarif'}`,
          }));
        }),
      );
      const flat = personLists.flat();
      insuredPersons = flat.map((entry) => entry.person);
      personOptions = flat.map((entry) => ({ id: entry.person.id, label: entry.label }));
      selectedPersonId = personOptions[0]?.id ?? '';

      // Positions roll-up per person (design §5.2.1, #239) for the Selbstbehalt radar.
      const rollups = await Promise.all(
        insuredPersons.map((ip) => api.stats.positions(ip.id).catch(() => null)),
      );
      positionRollups = rollups.filter((r): r is PositionYearRollup => r !== null);
    } catch (e) {
      loadError = e instanceof ApiError ? e.message : 'Daten konnten nicht geladen werden.';
    } finally {
      loading = false;
    }
  }

  async function loadYearStats() {
    yearStatsLoading = true;
    yearStatsError = null;
    try {
      yearStats = await Promise.all(yearWindow.map((year) => api.stats.year(year)));
    } catch (e) {
      yearStatsError =
        e instanceof ApiError ? e.message : 'Jahresstatistik konnte nicht geladen werden.';
    } finally {
      yearStatsLoading = false;
    }
  }

  async function loadBreHistory() {
    if (!selectedPersonId) {
      breHistory = null;
      return;
    }
    breLoading = true;
    breError = null;
    try {
      breHistory = await api.stats.bre(selectedPersonId);
    } catch (e) {
      breError = e instanceof ApiError ? e.message : 'BRE-Verlauf konnte nicht geladen werden.';
    } finally {
      breLoading = false;
    }
  }

  // Forward-looking Selbstbehalt/Einreich-Ampel per person for the current Leistungsjahr
  // (issue #234) — always the current year, independent of the retrospective year selector.
  const personRadars = $derived(
    insuredPersons.map((ip) => {
      const row = positionRollups
        .find((r) => r.insured_person_id === ip.id)
        ?.years.find((y) => y.year === currentYear);
      return {
        ip,
        label:
          personOptions.find((o) => o.id === ip.id)?.label ??
          ip.tariff_name ??
          ip.kvnr ??
          'Versicherte Person',
        radar: computeSelbstbehaltRadar({
          year: currentYear,
          R_Y: row ? row.eligible_amount + row.refund_amount : 0,
          alreadyReimbursed: row?.refund_amount ?? 0,
          selbstbehalt: ip.self_retention,
          breStructure: ip.bre_structure ?? null,
          monthlyPremium: ip.monthly_premium,
          discountRate: $settings.discountRate,
          claimFreeProbability: $settings.claimFreeProbability,
        }),
      };
    }),
  );

  onMount(loadBase);
  $effect(() => {
    if (!loading) void loadYearStats();
  });
  $effect(() => {
    if (!loading) void loadBreHistory();
  });
</script>

<svelte:head><title>Auswertung · selbstbehalt</title></svelte:head>

<div class="container mx-auto max-w-5xl px-4 py-8 space-y-6">
  <div class="space-y-1">
    <h1 class="text-2xl font-bold tracking-tight">Auswertung</h1>
    <p class="text-sm text-muted-foreground">
      Jahresanalyse: Kosten, Erstattungen und BRE-Jahresverlauf.
    </p>
  </div>

  {#if loading}
    <LoadingState label="Auswertung wird geladen …" />
  {:else if loadError}
    <ErrorState message={loadError} onRetry={loadBase} />
  {:else if !hasInvoiceYears && personOptions.length === 0}
    <EmptyState
      message="Noch keine Rechnungen oder versicherten Personen für eine Auswertung vorhanden."
    >
      {#snippet action()}
        <Button href={resolve('/')}>Zum Dashboard</Button>
      {/snippet}
    </EmptyState>
  {:else}
    <div class="flex items-center gap-3 flex-wrap">
      <span class="text-sm font-medium text-muted-foreground" id="stats-year-label">Jahr</span>
      <Select
        type="single"
        value={String(selectedYear)}
        onValueChange={(v: string) => {
          if (v) selectedYear = Number(v);
        }}
        items={availableYears.map((y) => ({ value: String(y), label: String(y) }))}
      >
        <SelectTrigger aria-labelledby="stats-year-label" class="w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {#each availableYears as year (year)}
            <SelectItem value={String(year)} label={String(year)} />
          {/each}
        </SelectContent>
      </Select>
    </div>

    <!-- Jahres-Kennzahlen -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <CardHeader class="pb-2">
          <CardDescription>Rechnungen {selectedYear}</CardDescription>
        </CardHeader>
        <CardContent>
          <p class="text-2xl font-bold tabular-nums">{selectedYearStats?.invoice_count ?? 0}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader class="pb-2">
          <CardDescription>Gesamtkosten</CardDescription>
        </CardHeader>
        <CardContent>
          <p class="text-xl font-bold tabular-nums">
            {formatEur(selectedYearStats?.total_amount ?? 0)}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader class="pb-2">
          <CardDescription>Erstattet</CardDescription>
        </CardHeader>
        <CardContent>
          <p class="text-xl font-bold tabular-nums">
            {formatEur(selectedYearStats?.refund_amount ?? 0)}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader class="pb-2">
          <CardDescription>BRE gebucht</CardDescription>
        </CardHeader>
        <CardContent>
          <p class="text-xl font-bold tabular-nums">
            {formatEur(selectedYearStats?.bre_amount ?? 0)}
          </p>
        </CardContent>
      </Card>
    </div>

    <!-- Selbstbehalt-Ausschöpfung & Einreich-Ampel — laufendes Leistungsjahr (issue #234) -->
    {#if personRadars.length > 0}
      <section class="space-y-3">
        <h2 class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Selbstbehalt-Ausschöpfung {currentYear}
        </h2>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {#each personRadars as { ip, label, radar } (ip.id)}
            <SelbstbehaltRadar {radar} {label} href={resolve('/insured/[id]', { id: ip.id })} />
          {/each}
        </div>
      </section>
    {/if}

    <!-- Kosten vs. Erstattungen -->
    <Card>
      <CardHeader>
        <CardTitle>Kosten vs. Erstattungen</CardTitle>
        <CardDescription>
          Gesamtkosten, Erstattungen und selbst getragene Beträge je Jahr ({yearWindow[0]}–{selectedYear}).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {#if yearStatsLoading}
          <LoadingState label="Kostenübersicht wird geladen …" />
        {:else if yearStatsError}
          <ErrorState message={yearStatsError} onRetry={loadYearStats} />
        {:else}
          <CostsRefundsChart data={yearStats} />
        {/if}
      </CardContent>
    </Card>

    <!-- BRE-Verlauf -->
    <Card>
      <CardHeader>
        <CardTitle>BRE-Verlauf</CardTitle>
        <CardDescription
          >Tatsächliche und prognostizierte Beitragsrückerstattung je Jahr.</CardDescription
        >
        {#if personOptions.length > 0}
          <div class="pt-2">
            <Select
              type="single"
              value={selectedPersonId}
              onValueChange={(v: string) => {
                if (v) selectedPersonId = v;
              }}
              items={personOptions.map((o) => ({ value: o.id, label: o.label }))}
            >
              <SelectTrigger class="w-full sm:w-72">
                <SelectValue placeholder="Versicherte Person wählen …" />
              </SelectTrigger>
              <SelectContent>
                {#each personOptions as option (option.id)}
                  <SelectItem value={option.id} label={option.label} />
                {/each}
              </SelectContent>
            </Select>
          </div>
        {/if}
      </CardHeader>
      <CardContent>
        {#if personOptions.length === 0}
          <EmptyState compact message="Noch keine versicherte Person angelegt." />
        {:else if breLoading}
          <LoadingState label="BRE-Verlauf wird geladen …" />
        {:else if breError}
          <ErrorState message={breError} onRetry={loadBreHistory} />
        {:else if !breHistory || breHistory.years.length === 0}
          <EmptyState compact message="Für diese Person liegt noch kein BRE-Verlauf vor." />
        {:else}
          <BreProgressionChart data={breHistory.years} />
        {/if}
      </CardContent>
    </Card>
  {/if}
</div>
