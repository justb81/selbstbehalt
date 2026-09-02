<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Jahresauswertung (docs/architecture.md §5.2, issue #28):
  Vollständige Jahresanalyse — Kosten, Erstattungen, BRE-Jahresverlauf.
  Das Dashboard zeigt offene Aktionen und BRE-Schnellstatus; diese Seite liefert
  die detaillierte Jahresanalyse über die Stats-API (#13). Der CSV/PDF-Export
  wurde nach #184 ausgegliedert.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { api, ApiError, serverStatus } from '$lib/api';
  import {
    formatEur,
    insuredPersonLabel,
    rollupYearToRY,
    type BREHistory,
    type InsuredPerson,
    type PositionYearRollup,
    type YearStats,
  } from '@selbstbehalt/shared';
  import { settings } from '$lib/stores/settings';
  import { computeSelbstbehaltRadar } from '$lib/utils/selbstbehalt-radar';
  import { partialFailureMessage, settledValues } from '$lib/utils/partial-load';
  import CostsRefundsChart from '$lib/components/CostsRefundsChart.svelte';
  import BreProgressionChart from '$lib/components/BreProgressionChart.svelte';
  import SelbstbehaltRadar from '$lib/components/SelbstbehaltRadar.svelte';
  import LoadingState from '$lib/components/LoadingState.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Skeleton } from '$lib/components/ui/skeleton';
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
  // `rollup: null` means "did not load" — kept apart from a loaded roll-up that
  // simply has no row for the year, which genuinely is R_Y = 0 (issue #381).
  let rollupResults = $state<{ id: string; rollup: PositionYearRollup | null }[]>([]);
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
            label: `${insuredPersonLabel(person)} · ${contract.insurer_name}`,
          }));
        }),
      );
      const flat = personLists.flat();
      insuredPersons = flat.map((entry) => entry.person);
      personOptions = flat.map((entry) => ({ id: entry.person.id, label: entry.label }));
      selectedPersonId = personOptions[0]?.id ?? '';

      // Positions roll-up per person (architecture §8.5.1, #239) for the Selbstbehalt radar.
      // Settled, not `all`: one person's failure must not lose the others — and
      // must not be swallowed either, or a missing roll-up renders as a green
      // "Einreichen folgenlos" Ampel (issue #381).
      const settled = await Promise.allSettled(
        insuredPersons.map((ip) => api.stats.positions(ip.id)),
      );
      const values = settledValues(settled);
      rollupResults = insuredPersons.map((ip, i) => ({ id: ip.id, rollup: values[i] ?? null }));
    } catch (e) {
      loadError = e instanceof ApiError ? e.message : 'Daten konnten nicht geladen werden.';
    } finally {
      loading = false;
    }
  }

  async function loadYearStats() {
    yearStatsLoading = true;
    yearStatsError = null;
    const years = yearWindow;
    try {
      // `Promise.all` used to let a single failing year drop the whole window,
      // which then rendered as four zeroed KPIs (issue #381).
      const settled = await Promise.allSettled(years.map((year) => api.stats.year(year)));
      const values = settledValues(settled);
      yearStats = values.filter((v): v is YearStats => v !== null);
      yearStatsError = partialFailureMessage(
        values.length - yearStats.length,
        values.length,
        'Jahreswerte',
      );
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
    insuredPersons.flatMap((ip) => {
      const rollup = rollupResults.find((r) => r.id === ip.id)?.rollup;
      // No roll-up means the value is unknown, not zero — render nothing rather
      // than a confident "nothing claimed yet" verdict (issue #381).
      if (!rollup) return [];
      const row = rollup.years.find((y) => y.year === currentYear);
      return {
        ip,
        label: personOptions.find((o) => o.id === ip.id)?.label ?? insuredPersonLabel(ip),
        radar: computeSelbstbehaltRadar({
          year: currentYear,
          // Safe now: a missing row on a *loaded* roll-up genuinely is R_Y = 0.
          R_Y: rollupYearToRY(row),
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

  const rollupWarning = $derived(
    partialFailureMessage(
      rollupResults.filter((r) => r.rollup === null).length,
      rollupResults.length,
      'Selbstbehalt-Werte',
    ),
  );

  onMount(loadBase);
  $effect(() => {
    if (!loading) void loadYearStats();
  });
  $effect(() => {
    if (!loading) void loadBreHistory();
  });

  // Reload once the server comes back (issue #381) — otherwise dismissing the
  // "Server nicht erreichbar" toast would leave the gaps on screen. A plain
  // `let`, not `$state`: the effect must not re-run on its own write.
  let lastRecovery = $serverStatus.recoveries;
  $effect(() => {
    const { recoveries } = $serverStatus;
    if (recoveries === lastRecovery) return;
    lastRecovery = recoveries;
    // loadBase() re-arms the two effects above, so one call refreshes everything.
    void loadBase();
  });
</script>

<svelte:head><title>Auswertung · selbstbehalt</title></svelte:head>

<!-- Eine Kennzahl. `unknown` rendert als „—" plus eine für Screenreader
     ausgeschriebene Begründung — ein Gedankenstrich allein wird vorgelesen als
     wäre da nichts, statt als „nicht verfügbar". -->
{#snippet kpi(value: string, unknown: boolean, size = 'text-xl')}
  <p class="{size} font-bold tabular-nums" class:text-muted-foreground={unknown}>
    {value}
    {#if unknown}<span class="sr-only">nicht verfügbar</span>{/if}
  </p>
{/snippet}

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

    <!-- Jahres-Kennzahlen. Die Kacheln hingen früher nur an `!loading` und
         coalescten jeden fehlenden Wert per `?? 0` — ein Ladefehler stand damit
         als „0,00 €" da, während der Hinweis darauf erst weit unten in der
         Chart-Karte auftauchte (issue #381). -->
    <section class="space-y-4" aria-labelledby="stats-kpi-heading">
      <h2 id="stats-kpi-heading" class="sr-only">Jahres-Kennzahlen</h2>
      {#if yearStatsError}
        <ErrorState
          title="Jahres-Kennzahlen unvollständig"
          message={yearStatsError}
          onRetry={loadYearStats}
        />
      {/if}
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader class="pb-2">
            <CardDescription>Rechnungen {selectedYear}</CardDescription>
          </CardHeader>
          <CardContent>
            {#if yearStatsLoading}
              <Skeleton class="h-8 w-14" />
            {:else}
              {@render kpi(
                selectedYearStats ? String(selectedYearStats.invoice_count) : '—',
                !selectedYearStats,
                'text-2xl',
              )}
            {/if}
          </CardContent>
        </Card>
        <Card>
          <CardHeader class="pb-2">
            <CardDescription>Gesamtkosten</CardDescription>
          </CardHeader>
          <CardContent>
            {#if yearStatsLoading}
              <Skeleton class="h-7 w-24" />
            {:else}
              {@render kpi(formatEur(selectedYearStats?.total_amount), !selectedYearStats)}
            {/if}
          </CardContent>
        </Card>
        <Card>
          <CardHeader class="pb-2">
            <CardDescription>Erstattet</CardDescription>
          </CardHeader>
          <CardContent>
            {#if yearStatsLoading}
              <Skeleton class="h-7 w-24" />
            {:else}
              {@render kpi(formatEur(selectedYearStats?.refund_amount), !selectedYearStats)}
            {/if}
          </CardContent>
        </Card>
        <Card>
          <CardHeader class="pb-2">
            <CardDescription>BRE gebucht</CardDescription>
          </CardHeader>
          <CardContent>
            {#if yearStatsLoading}
              <Skeleton class="h-7 w-24" />
            {:else}
              {@render kpi(formatEur(selectedYearStats?.bre_amount), !selectedYearStats)}
            {/if}
          </CardContent>
        </Card>
      </div>
    </section>

    <!-- Selbstbehalt-Ausschöpfung & Einreich-Ampel — laufendes Leistungsjahr (issue #234) -->
    {#if rollupWarning}
      <ErrorState
        title="Selbstbehalt-Stand unvollständig"
        message={rollupWarning}
        onRetry={loadBase}
      />
    {/if}
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
        <!-- Teilweise geladene Jahre werden gezeichnet; welche fehlen, sagt der
             Hinweis über den Kennzahlen — mit dem einen Retry, statt dieselbe
             Meldung zweimal auf der Seite zu führen. -->
        {#if yearStatsLoading}
          <LoadingState label="Kostenübersicht wird geladen …" />
        {:else if yearStats.length > 0}
          <CostsRefundsChart data={yearStats} />
        {:else if yearStatsError}
          <EmptyState compact message="Kurve nicht verfügbar, solange die Jahreswerte fehlen." />
        {:else}
          <EmptyState compact message="Für diesen Zeitraum liegen keine Jahreswerte vor." />
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
