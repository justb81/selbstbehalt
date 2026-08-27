<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Vertragsverwaltung-Liste (docs/architecture.md §5.2, issue #21).
  Shows all contracts as ContractCards with insured-person counts.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { api } from '$lib/api';
  import type { Contract } from '$lib/api/resources';
  import ContractCard from '$lib/components/ContractCard.svelte';
  import LoadingState from '$lib/components/LoadingState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { partialFailureMessage, settledValues } from '$lib/utils/partial-load';
  import { Button } from '$lib/components/ui/button';

  let contracts = $state<Contract[]>([]);
  // `null` = konnte nicht geladen werden — bewusst getrennt von einer echten 0
  // (issue #396).
  let insuredCounts = $state<Record<string, number | null>>({});
  let loading = $state(true);
  let error = $state<string | null>(null);
  let countWarning = $state<string | null>(null);

  async function load() {
    loading = true;
    error = null;
    countWarning = null;
    try {
      const list = await api.contracts.list();
      // Settled statt eines verschluckenden try/catch: ein gescheiterter Lookup
      // ergab früher `0` und damit „0 versicherte Personen" für einen Vertrag
      // mit drei — ununterscheidbar von einem wirklich leeren (issue #396).
      const settled = await Promise.allSettled(list.map((c) => api.insured.list(c.id)));
      const values = settledValues(settled);
      contracts = list;
      insuredCounts = Object.fromEntries(
        list.map((c, i) => [c.id, values[i]?.length ?? null] as const),
      );
      countWarning = partialFailureMessage(
        values.filter((v) => v === null).length,
        values.length,
        'Versicherten-Zähler',
      );
    } catch {
      error = 'Verträge konnten nicht geladen werden.';
    } finally {
      loading = false;
    }
  }

  onMount(load);
</script>

<svelte:head><title>Verträge · selbstbehalt</title></svelte:head>

<div class="container mx-auto max-w-5xl px-4 py-8 space-y-6">
  <div class="flex items-center justify-between flex-wrap gap-3">
    <h1 class="text-2xl font-bold tracking-tight">Verträge</h1>
    <Button href={resolve('/contracts/new')}>+ Neuer Vertrag</Button>
  </div>

  {#if loading}
    <LoadingState label="Verträge werden geladen …" />
  {:else if error}
    <ErrorState title="Fehler beim Laden" message={error} onRetry={load} />
  {:else if contracts.length === 0}
    <EmptyState message="Noch keine Verträge angelegt.">
      {#snippet action()}
        <Button href={resolve('/contracts/new')}>Ersten Vertrag anlegen</Button>
      {/snippet}
    </EmptyState>
  {:else}
    {#if countWarning}
      <ErrorState title="Unvollständig geladen" message={countWarning} onRetry={load} />
    {/if}
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {#each contracts as contract (contract.id)}
        <ContractCard {contract} insuredCount={insuredCounts[contract.id] ?? null} />
      {/each}
    </div>
  {/if}
</div>
