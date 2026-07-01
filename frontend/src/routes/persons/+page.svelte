<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Personenverwaltung-Liste (docs/design.md §3.1, issue #35).
  Shows all persons; each can be Versicherungsnehmer and/or versicherte Person.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { api } from '$lib/api';
  import type { Person } from '$lib/api/resources';
  import { formatDate } from '@selbstbehalt/shared';
  import LoadingState from '$lib/components/LoadingState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import { Button } from '$lib/components/ui/button';

  let persons = $state<Person[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function load() {
    loading = true;
    error = null;
    try {
      persons = await api.persons.list();
    } catch {
      error = 'Personen konnten nicht geladen werden.';
    } finally {
      loading = false;
    }
  }

  onMount(load);
</script>

<svelte:head><title>Personen · selbstbehalt</title></svelte:head>

<div class="container mx-auto max-w-5xl px-4 py-8 space-y-6">
  <div class="flex items-center justify-between flex-wrap gap-3">
    <div>
      <h1 class="text-2xl font-bold tracking-tight">Personen</h1>
      <p class="text-sm text-muted-foreground mt-0.5">
        Versicherungsnehmer und Haushaltsmitglieder. Versicherte Personen (mit Tarif, KVNR, BRE)
        werden im
        <a href={resolve('/contracts')} class="underline hover:text-primary">Vertrag</a> verwaltet.
      </p>
    </div>
    <Button href={resolve('/persons/new')}>+ Neue Person</Button>
  </div>

  {#if loading}
    <LoadingState label="Personen werden geladen …" />
  {:else if error}
    <ErrorState title="Fehler beim Laden" message={error} onRetry={load} />
  {:else if persons.length === 0}
    <div class="flex flex-col items-center justify-center py-16 text-center">
      <p class="text-muted-foreground">Noch keine Personen angelegt.</p>
      <Button class="mt-4" href={resolve('/persons/new')}>Erste Person anlegen</Button>
    </div>
  {:else}
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {#each persons as person (person.id)}
        <a
          href={resolve('/persons/[id]', { id: person.id })}
          class="flex flex-col gap-1 p-4 bg-card border border-border rounded-md shadow-sm no-underline text-foreground hover:border-primary transition-colors"
        >
          <span class="font-semibold">{person.name}</span>
          {#if person.birth_date}
            <span class="text-sm text-muted-foreground">geb. {formatDate(person.birth_date)}</span>
          {/if}
        </a>
      {/each}
    </div>
  {/if}
</div>
