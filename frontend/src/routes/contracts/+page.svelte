<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Vertragsverwaltung-Liste (docs/design.md §6.1, issue #21).
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

  let contracts = $state<Contract[]>([]);
  let insuredCounts = $state<Record<string, number>>({});
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function load() {
    loading = true;
    error = null;
    try {
      const list = await api.contracts.list();
      const counts = await Promise.all(
        list.map(async (c) => {
          try {
            const persons = await api.insured.list(c.id);
            return [c.id, persons.length] as const;
          } catch {
            return [c.id, 0] as const;
          }
        }),
      );
      contracts = list;
      insuredCounts = Object.fromEntries(counts);
    } catch {
      error = 'Verträge konnten nicht geladen werden.';
    } finally {
      loading = false;
    }
  }

  onMount(load);
</script>

<svelte:head><title>Verträge · selbstbehalt</title></svelte:head>

<section class="page">
  <div class="page-header">
    <h1>Verträge</h1>
    <a href={resolve('/contracts/new')} class="btn-primary">+ Neuer Vertrag</a>
  </div>

  {#if loading}
    <LoadingState label="Verträge werden geladen …" />
  {:else if error}
    <ErrorState title="Fehler beim Laden" message={error} onRetry={load} />
  {:else if contracts.length === 0}
    <div class="empty">
      <p>Noch keine Verträge angelegt.</p>
      <a href={resolve('/contracts/new')} class="btn-primary">Ersten Vertrag anlegen</a>
    </div>
  {:else}
    <div class="contract-grid">
      {#each contracts as contract (contract.id)}
        <ContractCard {contract} insuredCount={insuredCounts[contract.id] ?? 0} />
      {/each}
    </div>
  {/if}
</section>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  h1 {
    margin: 0;
  }

  .contract-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
    gap: var(--space-4);
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-8);
    text-align: center;
    color: var(--color-text-muted);
  }

  .btn-primary {
    display: inline-flex;
    align-items: center;
    padding: var(--space-2) var(--space-4);
    border: none;
    border-radius: var(--radius-sm);
    background: var(--color-primary);
    color: var(--color-primary-contrast);
    font: inherit;
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
  }

  .btn-primary:hover {
    background: var(--color-primary-strong);
  }
</style>
