<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Personendetail (docs/design.md §3.1, issue #35): name and birth date,
  inline edit, delete, and a link to contracts held by this person.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import type { Person } from '$lib/api/resources';
  import LoadingState from '$lib/components/LoadingState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';

  const personId = $derived(page.params.id as string);

  let person = $state<Person | null>(null);
  let loading = $state(true);
  let loadError = $state<string | null>(null);

  async function load() {
    loading = true;
    loadError = null;
    try {
      person = await api.persons.get(personId);
    } catch (e) {
      loadError = e instanceof ApiError || e instanceof Error ? e.message : 'Laden fehlgeschlagen.';
    } finally {
      loading = false;
    }
  }

  onMount(load);

  // ---- Edit ----
  let editing = $state(false);
  let editName = $state('');
  let editBirthDate = $state('');
  let saving = $state(false);
  let saveError = $state<string | null>(null);

  function startEdit() {
    if (!person) return;
    editName = person.name;
    editBirthDate = person.birth_date ?? '';
    editing = true;
    saveError = null;
  }

  function cancelEdit() {
    editing = false;
    saveError = null;
  }

  async function save() {
    if (!person) return;
    if (!editName.trim()) {
      saveError = 'Name darf nicht leer sein.';
      return;
    }
    saving = true;
    saveError = null;
    try {
      person = await api.persons.update(person.id, {
        name: editName.trim(),
        birth_date: editBirthDate.trim() || null,
      });
      editing = false;
    } catch (e) {
      saveError =
        e instanceof ApiError || e instanceof Error ? e.message : 'Speichern fehlgeschlagen.';
    } finally {
      saving = false;
    }
  }

  // ---- Delete ----
  let confirmDelete = $state(false);
  let deleting = $state(false);

  async function deletePerson() {
    if (!person) return;
    deleting = true;
    try {
      await api.persons.remove(person.id);
      await goto(resolve('/persons'));
    } catch (e) {
      loadError =
        e instanceof ApiError || e instanceof Error ? e.message : 'Löschen fehlgeschlagen.';
      deleting = false;
      confirmDelete = false;
    }
  }
</script>

<svelte:head>
  <title>{person ? `${person.name} · selbstbehalt` : 'Personendetail · selbstbehalt'}</title>
</svelte:head>

<section class="page">
  <div class="page-header">
    <a href={resolve('/persons')} class="back-link">← Personen</a>
    <h1>Personendetail</h1>
  </div>

  {#if loading}
    <LoadingState label="Person wird geladen …" />
  {:else if loadError}
    <ErrorState title="Fehler beim Laden" message={loadError} onRetry={load} />
  {:else if person}
    {#if editing}
      <form
        class="card"
        onsubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2>Person bearbeiten</h2>

        <div class="field-grid">
          <label class="field">
            <span>Name <span class="req">*</span></span>
            <input type="text" bind:value={editName} required />
          </label>

          <label class="field">
            <span>Geburtsdatum</span>
            <input type="date" bind:value={editBirthDate} />
          </label>
        </div>

        {#if saveError}
          <p class="error" role="alert">{saveError}</p>
        {/if}

        <div class="actions">
          <button type="submit" class="btn-primary" disabled={saving}>
            {saving ? 'Wird gespeichert …' : 'Speichern'}
          </button>
          <button type="button" class="btn-secondary" onclick={cancelEdit} disabled={saving}>
            Abbrechen
          </button>
        </div>
      </form>
    {:else}
      <div class="card">
        <div class="detail-header">
          <div>
            <p class="label">Name</p>
            <p class="value">{person.name}</p>
          </div>
          {#if person.birth_date}
            <div>
              <p class="label">Geburtsdatum</p>
              <p class="value">{person.birth_date}</p>
            </div>
          {/if}
        </div>

        <div class="actions">
          <button type="button" class="btn-secondary" onclick={startEdit}>Bearbeiten</button>
          <a href={resolve('/contracts')} class="btn-secondary">Verträge anzeigen</a>
          {#if confirmDelete}
            <span class="confirm-text">Wirklich löschen?</span>
            <button
              type="button"
              class="btn-danger"
              disabled={deleting}
              onclick={() => void deletePerson()}
            >
              {deleting ? 'Wird gelöscht …' : 'Ja, löschen'}
            </button>
            <button
              type="button"
              class="btn-secondary"
              onclick={() => {
                confirmDelete = false;
              }}
            >
              Abbrechen
            </button>
          {:else}
            <button
              type="button"
              class="btn-danger-outline"
              onclick={() => {
                confirmDelete = true;
              }}
            >
              Löschen
            </button>
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</section>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .page-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  h1 {
    margin: 0;
  }

  .back-link {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    text-decoration: none;
  }

  .back-link:hover {
    color: var(--color-primary);
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
  }

  h2 {
    margin: 0;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
  }

  .detail-header {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-5);
  }

  .label {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    margin: 0 0 var(--space-1);
  }

  .value {
    font-weight: 600;
    margin: 0;
  }

  .field-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: var(--space-3);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .field input {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font: inherit;
    color: var(--color-text);
    background: var(--color-bg);
  }

  .field input:focus {
    outline: 2px solid var(--color-primary);
    outline-offset: 1px;
  }

  .req {
    color: var(--color-danger);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }

  .confirm-text {
    font-size: var(--font-size-sm);
    color: var(--color-danger);
  }

  .btn-primary {
    padding: var(--space-2) var(--space-5);
    border: none;
    border-radius: var(--radius-sm);
    background: var(--color-primary);
    color: var(--color-primary-contrast);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--color-primary-strong);
  }

  .btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-secondary {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    font-weight: 500;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    cursor: pointer;
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--color-bg);
  }

  .btn-secondary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-danger {
    padding: var(--space-2) var(--space-4);
    border: none;
    border-radius: var(--radius-sm);
    background: var(--color-danger);
    color: #fff;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-danger:hover:not(:disabled) {
    filter: brightness(0.9);
  }

  .btn-danger:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-danger-outline {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-danger);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-danger);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
  }

  .btn-danger-outline:hover {
    background: color-mix(in srgb, var(--color-danger) 8%, transparent);
  }

  .error {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
    margin: 0;
  }
</style>
