<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Dashboard (docs/design.md §6.1, issue #23): overview of open invoices,
  pending actions, year stats and per-person BRE status.
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
  import { computeSelbstbehaltRadar } from '$lib/utils/selbstbehalt-radar';
  import BRETracker from '$lib/components/BRETracker.svelte';
  import SelbstbehaltRadar from '$lib/components/SelbstbehaltRadar.svelte';
  import InvoiceBadge from '$lib/components/InvoiceBadge.svelte';
  import LoadingState from '$lib/components/LoadingState.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';

  // ---- State ----
  let invoices = $state<Invoice[]>([]);
  let insuredPersons = $state<InsuredPerson[]>([]);
  let positionRollups = $state<PositionYearRollup[]>([]);
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
    <LoadingState label="Dashboard wird geladen …" />
  {:else}
    <!-- Stats tiles -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
      <Card>
        <CardHeader class="pb-2">
          <CardDescription>Offene Rechnungen</CardDescription>
        </CardHeader>
        <CardContent>
          <p class="text-2xl font-bold tabular-nums">{openInvoices.length}</p>
          {#if openInvoices.length > 0}
            <a href={resolve('/invoices')} class="text-sm text-primary hover:underline font-medium">
              Anzeigen →
            </a>
          {/if}
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="pb-2">
          <CardDescription>Ausstehende Einreichungen</CardDescription>
        </CardHeader>
        <CardContent>
          <p class="text-2xl font-bold tabular-nums">{pendingSubmissions.length}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="pb-2">
          <CardDescription>Rechnungen {year}</CardDescription>
        </CardHeader>
        <CardContent>
          <p class="text-2xl font-bold tabular-nums">
            {invoices.filter((i) => i.invoice_date?.startsWith(String(year))).length}
          </p>
          {#if totalAmount > 0}
            <p class="text-sm text-muted-foreground">{formatEur(totalAmount)} gesamt</p>
          {/if}
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="pb-2">
          <CardDescription>Erstattungsfähig {year}</CardDescription>
        </CardHeader>
        <CardContent>
          <p class="text-xl font-bold tabular-nums">{formatEur(eligibleAmount)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="pb-2">
          <CardDescription>Verträge</CardDescription>
        </CardHeader>
        <CardContent>
          <p class="text-2xl font-bold tabular-nums">{contractCount}</p>
          <a href={resolve('/contracts')} class="text-sm text-primary hover:underline font-medium">
            Verwalten →
          </a>
        </CardContent>
      </Card>
    </div>

    <!-- Open invoices -->
    {#if openInvoices.length > 0}
      <div class="space-y-3">
        <h2 class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Offene Rechnungen
        </h2>
        <div class="rounded-md border border-border bg-card shadow-sm overflow-hidden">
          {#each openInvoices.slice(0, 5) as invoice (invoice.id)}
            <a
              href={resolve('/invoices/[id]', { id: invoice.id })}
              class="grid grid-cols-[7rem_1fr_8rem_auto] gap-2 items-center px-4 py-3 border-b border-border last:border-b-0 hover:bg-muted/50 text-sm no-underline text-foreground"
            >
              <span class="text-muted-foreground">{formatDate(invoice.invoice_date)}</span>
              <span>{invoice.provider_name}</span>
              <span class="text-right font-medium tabular-nums"
                >{formatEur(invoice.total_amount)}</span
              >
              <InvoiceBadge status={invoice.status} />
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

    <!-- Selbstbehalt-Ausschöpfung & Einreich-Ampel (issue #234) -->
    {#if personRadars.length > 0}
      <div class="space-y-3">
        <h2 class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Selbstbehalt-Ausschöpfung {year}
        </h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {#each personRadars as { ip, radar } (ip.id)}
            <SelbstbehaltRadar
              {radar}
              compact
              label={ip.tariff_name ?? ip.kvnr ?? 'Versicherte Person'}
              href={resolve('/insured/[id]', { id: ip.id })}
            />
          {/each}
        </div>
      </div>
    {/if}

    <!-- BRE status -->
    {#if insuredPersons.length > 0}
      <div class="space-y-3">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            BRE-Status
          </h2>
          <a href={resolve('/insured')} class="text-xs text-primary hover:underline font-medium">
            Alle Versicherten →
          </a>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {#each insuredPersons as ip (ip.id)}
            <BRETracker
              insuredPerson={ip}
              compact={true}
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
    {/if}

    {#if hasError}
      <Alert variant="destructive">
        <AlertDescription>Einige Daten konnten nicht geladen werden.</AlertDescription>
      </Alert>
    {/if}
  {/if}
</div>
