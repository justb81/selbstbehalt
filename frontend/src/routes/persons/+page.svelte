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
  import LoadingState from '$lib/components/LoadingState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';

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

<section class="page">
  <div class="page-header">
    <h1>Personen</h1>
    <a href={resolve('/persons/new')} class="btn-primary">+ Neue Person</a>
  </div>

  {#if loading}
    <LoadingState label="Personen werden geladen …" />
  {:else if error}
    <ErrorState title="Fehler beim Laden" message={error} onRetry={load} />
  {:else if persons.length === 0}
    <div class="empty">
      <p>Noch keine Personen angelegt.</p>
      <a href={resolve('/persons/new')} class="btn-primary">Erste Person anlegen</a>
    </div>
  {:else}
    <div class="person-grid">
      {#each persons as person (person.id)}
        <a href={resolve('/persons/[id]', { id: person.id })} class="person-card">
          <span class="person-name">{person.name}</span>
          {#if person.birth_date}
            <span class="person-meta">geb. {person.birth_date}</span>
          {/if}
        </a>
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

  .person-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
    gap: var(--space-4);
  }

  .person-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-4) var(--space-5);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    text-decoration: none;
    color: inherit;
    transition: border-color 0.15s;
  }

  .person-card:hover {
    border-color: var(--color-primary);
  }

  .person-name {
    font-weight: 600;
    color: var(--color-text);
  }

  .person-meta {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
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
