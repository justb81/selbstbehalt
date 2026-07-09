<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Dashboard (docs/design.md §6.1, issue #23): overview of open invoices,
  pending actions, year stats and per-person Selbstbehalt/BRE status. Reworked
  for UX consistency in issue #261 — see that issue for the full rationale
  (KPI-tile baselines, one merged card per person, compact-mode legends, error/
  loading states, and the mobile invoice-row layout).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { api } from '$lib/api';
  import {
    formatDate,
    formatEur,
    type InsuredPerson,
    type Invoice,
    type PositionYearRollup,
  } from '@selbstbehalt/shared';
  import { settings } from '$lib/stores/settings';
  import { ampelPriority, computeSelbstbehaltRadar } from '$lib/utils/selbstbehalt-radar';
  import PersonStatusCard from '$lib/components/PersonStatusCard.svelte';
  import InvoiceBadge from '$lib/components/InvoiceBadge.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';
  import { Skeleton } from '$lib/components/ui/skeleton';

  // ---- State ----
  let invoices = $state<Invoice[]>([]);
  let insuredPersons = $state<InsuredPerson[]>([]);
  let positionRollups = $state<PositionYearRollup[]>([]);
  let contractCount = $state(0);
  let yearInvoiceCount = $state(0);
  let totalAmount = $state(0);
  let eligibleAmount = $state(0);
  let loading = $state(true);
  let hasError = $state(false);

  const openInvoices = $derived(
    invoices.filter((i) => i.status === 'neu' || i.status === 'geprüft'),
  );
  const pendingSubmissions = $derived(invoices.filter((i) => i.status === 'eingereicht'));
  const year = new Date().getFullYear();
  // resolve() has no query-string support; appended here once so the "Anzeigen
  // →" link below can stay a plain, single-line <a>.
  const pendingSubmissionsHref = `${resolve('/invoices')}?status=eingereicht`;
  // Shared KPI-tile footer-link style, kept as a const so each <a> stays on one
  // line — the eslint-disable for the pre-resolved href must sit directly above it.
  const tileLinkClass = 'text-sm text-primary hover:underline font-medium';

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
      yearInvoiceCount = yearInvoices.length;
      totalAmount = yearInvoices.reduce((s, i) => s + i.total_amount, 0);
      eligibleAmount = yearInvoices.reduce((s, i) => s + (i.eligible_amount ?? 0), 0);

      // Load insured persons for BRE tracking
      const personLists = await Promise.all(
        contracts.map((c) => api.insured.list(c.id).catch(() => [])),
      );
      insuredPersons = personLists.flat();

      // Positions roll-up per person (design §5.2.1, #239) for the Selbstbehalt radar.
      const rollups = await Promise.all(
        insuredPersons.map((ip) => api.stats.positions(ip.id).catch(() => null)),
      );
      positionRollups = rollups.filter((r): r is PositionYearRollup => r !== null);
    } catch {
      hasError = true;
    } finally {
      loading = false;
    }
  }

  onMount(load);

  // Insured person label for the open-invoices rows (#261) — every invoice
  // belongs to exactly one insured person, but the row itself only showed
  // provider/date/amount, invisible in multi-person households.
  const insuredLabelById = $derived(
    new Map(insuredPersons.map((ip) => [ip.id, ip.tariff_name ?? ip.kvnr ?? 'Versicherte Person'])),
  );

  // Forward-looking Selbstbehalt/Einreich-Ampel per person for the current year (#234).
  const personRadars = $derived(
    insuredPersons.map((ip) => {
      const row = positionRollups
        .find((r) => r.insured_person_id === ip.id)
        ?.years.find((y) => y.year === year);
      return {
        ip,
        radar: computeSelbstbehaltRadar({
          year,
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

  // Most actionable person first — "Einreichen lohnt" must not sit below two
  // cards where submitting is currently inconsequential (#261).
  const personCards = $derived(
    [...personRadars].sort((a, b) => ampelPriority(a.radar.state) - ampelPriority(b.radar.state)),
  );

  const invoiceRowClass =
    'flex flex-col gap-1.5 px-4 py-3 border-b border-border last:border-b-0 hover:bg-muted/50 text-sm no-underline text-foreground sm:grid sm:grid-cols-[7rem_1fr_8rem_auto] sm:items-center sm:gap-2';
</script>

<svelte:head><title>Dashboard · selbstbehalt</title></svelte:head>

<div class="container mx-auto max-w-5xl px-4 py-8 space-y-6">
  <div class="flex items-center justify-between flex-wrap gap-3">
    <h1 class="text-2xl font-bold tracking-tight">Dashboard</h1>
    <div class="flex gap-2 flex-wrap">
      <Button href={resolve('/invoices/scan')}>Rechnung scannen</Button>
      <Button variant="outline" href={resolve('/contracts/new')}>Vertrag anlegen</Button>
    </div>
  </div>

  {#if loading}
    <span class="sr-only" role="status" aria-live="polite">Dashboard wird geladen …</span>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" aria-hidden="true">
      {#each [0, 1, 2, 3] as i (i)}
        <Card>
          <CardHeader class="pb-2"><Skeleton class="h-4 w-28" /></CardHeader>
          <CardContent class="flex flex-col gap-2">
            <Skeleton class="h-8 w-14" />
            <Skeleton class="h-4 w-20" />
          </CardContent>
        </Card>
      {/each}
    </div>
    <div class="space-y-3" aria-hidden="true">
      <Skeleton class="h-4 w-36" />
      <div class="rounded-md border border-border bg-card shadow-sm overflow-hidden">
        {#each [0, 1, 2] as i (i)}
          <div class="flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0">
            <Skeleton class="h-4 w-14 shrink-0" />
            <Skeleton class="h-4 flex-1" />
            <Skeleton class="h-4 w-16 shrink-0" />
          </div>
        {/each}
      </div>
    </div>
    <div class="space-y-3" aria-hidden="true">
      <Skeleton class="h-4 w-44" />
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Skeleton class="h-28 rounded-xl" />
        <Skeleton class="h-28 rounded-xl" />
      </div>
    </div>
  {:else}
    {#if hasError}
      <Alert variant="destructive">
        <AlertDescription>Einige Daten konnten nicht geladen werden.</AlertDescription>
      </Alert>
    {/if}

    <!-- Stats tiles -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <CardHeader class="pb-2">
          <CardDescription class="truncate">Offene Rechnungen</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col gap-1">
          <p class="text-2xl font-bold tabular-nums">{openInvoices.length}</p>
          <div class="min-h-5">
            {#if openInvoices.length > 0}
              <a href="#offene-rechnungen" class={tileLinkClass}>Anzeigen →</a>
            {/if}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="pb-2">
          <CardDescription class="truncate">Ausstehende Einreichungen</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col gap-1">
          <p class="text-2xl font-bold tabular-nums">{pendingSubmissions.length}</p>
          <div class="min-h-5">
            {#if pendingSubmissions.length > 0}
              <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- query string appended to a resolved path -->
              <a href={pendingSubmissionsHref} class={tileLinkClass}>Anzeigen →</a>
            {/if}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="pb-2">
          <CardDescription class="truncate">Jahr {year}</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col gap-1">
          <p class="text-2xl font-bold tabular-nums">{yearInvoiceCount}</p>
          <div class="min-h-5">
            {#if totalAmount > 0}
              <p class="text-muted-foreground truncate text-xs">
                {formatEur(totalAmount)}{#if eligibleAmount > 0}, {formatEur(eligibleAmount)}
                  erstattungsfähig{/if}
              </p>
            {/if}
            <a href={resolve('/stats')} class={tileLinkClass}>Zur Auswertung →</a>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="pb-2">
          <CardDescription class="truncate">Verträge</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col gap-1">
          <p class="text-2xl font-bold tabular-nums">{contractCount}</p>
          <div class="min-h-5">
            <a href={resolve('/contracts')} class={tileLinkClass}>Verwalten →</a>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Open invoices -->
    {#if openInvoices.length > 0}
      <div class="space-y-3" id="offene-rechnungen">
        <h2 class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Offene Rechnungen
        </h2>
        <div class="rounded-md border border-border bg-card shadow-sm overflow-hidden">
          {#each openInvoices.slice(0, 5) as invoice (invoice.id)}
            <a href={resolve('/invoices/[id]', { id: invoice.id })} class={invoiceRowClass}>
              <span class="flex items-center justify-between gap-2 sm:contents">
                <span class="text-muted-foreground sm:order-1"
                  >{formatDate(invoice.invoice_date)}</span
                >
                <span class="sm:order-4"><InvoiceBadge status={invoice.status} /></span>
              </span>
              <span class="flex items-center justify-between gap-2 sm:contents">
                <span class="min-w-0 sm:order-2">
                  <span class="block truncate">{invoice.provider_name}</span>
                  <span class="block text-xs font-normal text-muted-foreground truncate">
                    {insuredLabelById.get(invoice.insured_person_id) ?? 'Versicherte Person'}
                  </span>
                </span>
                <span class="text-right font-medium tabular-nums shrink-0 sm:order-3">
                  {formatEur(invoice.total_amount)}
                </span>
              </span>
            </a>
          {/each}
          {#if openInvoices.length > 5}
            <a
              href={resolve('/invoices')}
              class="block px-4 py-2 text-center text-sm text-primary hover:underline border-t border-border bg-muted/30"
            >
              + {openInvoices.length - 5} weitere →
            </a>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Selbstbehalt & BRE status — one merged card per person (issue #261),
         sorted by Ampel priority (most actionable first). -->
    {#if insuredPersons.length > 0}
      <div class="space-y-3">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Selbstbehalt & BRE-Status
          </h2>
          <a href={resolve('/insured')} class="text-xs text-primary hover:underline font-medium">
            Alle Versicherten →
          </a>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {#each personCards as { ip, radar } (ip.id)}
            <PersonStatusCard
              insuredPerson={ip}
              {radar}
              href={resolve('/insured/[id]', { id: ip.id })}
            />
          {/each}
        </div>
      </div>
    {:else if contractCount === 0}
      <EmptyState message="Noch keine Verträge angelegt.">
        {#snippet action()}
          <Button href={resolve('/contracts/new')}>Ersten Vertrag anlegen</Button>
        {/snippet}
      </EmptyState>
    {:else}
      <EmptyState message="Noch keine versicherten Personen angelegt.">
        {#snippet action()}
          <p class="text-sm text-muted-foreground">
            Versicherte Personen werden im
            <a href={resolve('/contracts')} class="underline hover:text-primary">Vertrag</a>
            angelegt.
          </p>
        {/snippet}
      </EmptyState>
    {/if}
  {/if}
</div>
