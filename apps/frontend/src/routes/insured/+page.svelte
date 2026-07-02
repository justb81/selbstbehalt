<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Versicherte Personen — Listenansicht (docs/design.md §6.1, issue #134):
  Alle versicherten Personen über alle Verträge, gruppiert nach Vertrag.
  Zentraler Einstieg: BRE-Staffel und Günstigerprüfung je Person unter /insured/[id].
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { api } from '$lib/api';
  import { formatEur, type Contract, type InsuredPerson } from '@selbstbehalt/shared';
  import BRETracker from '$lib/components/BRETracker.svelte';
  import LoadingState from '$lib/components/LoadingState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { Badge } from '$lib/components/ui/badge';

  interface ContractGroup {
    contract: Contract;
    insuredPersons: InsuredPerson[];
  }

  let groups = $state<ContractGroup[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function load() {
    loading = true;
    error = null;
    try {
      const contracts = await api.contracts.list();
      const insuredLists = await Promise.all(
        contracts.map((c) => api.insured.list(c.id).catch(() => [])),
      );
      groups = contracts
        .map((c, i) => ({ contract: c, insuredPersons: insuredLists[i]! }))
        .filter((g) => g.insuredPersons.length > 0);
    } catch {
      error = 'Versicherte Personen konnten nicht geladen werden.';
    } finally {
      loading = false;
    }
  }

  onMount(load);
</script>

<svelte:head><title>Versicherte · selbstbehalt</title></svelte:head>

<div class="container mx-auto max-w-5xl px-4 py-8 space-y-6">
  <div class="space-y-1">
    <h1 class="text-2xl font-bold tracking-tight">Versicherte</h1>
    <p class="text-sm text-muted-foreground">
      Alle versicherten Personen mit Tarif, BRE-Staffel und Günstigerprüfung.
    </p>
  </div>

  {#if loading}
    <LoadingState label="Versicherte werden geladen …" />
  {:else if error}
    <ErrorState title="Fehler beim Laden" message={error} onRetry={load} />
  {:else if groups.length === 0}
    <EmptyState message="Noch keine versicherten Personen vorhanden.">
      {#snippet action()}
        <p class="text-sm text-muted-foreground">
          Versicherte Personen werden im <a
            href={resolve('/contracts')}
            class="underline hover:text-primary">Vertrag</a
          > angelegt.
        </p>
      {/snippet}
    </EmptyState>
  {:else}
    <div class="space-y-8">
      {#each groups as group (group.contract.id)}
        <div class="space-y-3">
          <div class="flex items-center gap-3">
            <a
              href={resolve('/contracts/[id]', { id: group.contract.id })}
              class="text-sm font-semibold hover:underline hover:text-primary"
            >
              {group.contract.insurer_name}
            </a>
            <Badge variant="secondary" class="text-xs"
              >{group.insuredPersons.length}
              {group.insuredPersons.length === 1 ? 'Person' : 'Personen'}</Badge
            >
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {#each group.insuredPersons as ip (ip.id)}
              <div class="space-y-2">
                <div class="flex items-center justify-between gap-2 px-1">
                  <a
                    href={resolve('/insured/[id]', { id: ip.id })}
                    class="font-medium text-sm hover:text-primary hover:underline transition-colors"
                  >
                    {ip.tariff_name ?? ip.kvnr ?? 'Versicherte Person'}
                  </a>
                  <span class="text-xs text-muted-foreground tabular-nums">
                    {formatEur(ip.monthly_premium)} / Monat
                  </span>
                </div>
                <BRETracker
                  insuredPerson={ip}
                  compact={true}
                  href={resolve('/insured/[id]', { id: ip.id })}
                />
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
