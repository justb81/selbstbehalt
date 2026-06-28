<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Neue Person anlegen (docs/design.md §3.1, issue #35).
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { api, ApiError } from '$lib/api';

  let name = $state('');
  let birthDate = $state('');
  let saving = $state(false);
  let formError = $state<string | null>(null);

  async function submit() {
    formError = null;
    if (!name.trim()) {
      formError = 'Bitte den Namen eingeben.';
      return;
    }
    saving = true;
    try {
      const person = await api.persons.create({
        name: name.trim(),
        birth_date: birthDate.trim() || null,
      });
      await goto(resolve('/persons/[id]', { id: person.id }));
    } catch (e) {
      formError =
        e instanceof ApiError || e instanceof Error
          ? e.message
          : 'Person konnte nicht gespeichert werden.';
      saving = false;
    }
  }
</script>

<svelte:head><title>Neue Person · selbstbehalt</title></svelte:head>

<section class="page">
  <div class="page-header">
    <a href={resolve('/persons')} class="back-link">← Personen</a>
    <h1>Neue Person</h1>
  </div>

  <form
    class="card"
    onsubmit={(e) => {
      e.preventDefault();
      void submit();
    }}
  >
    <div class="field-grid">
      <label class="field">
        <span>Name <span class="req">*</span></span>
        <input type="text" bind:value={name} required placeholder="Vollständiger Name" />
      </label>

      <label class="field">
        <span>Geburtsdatum</span>
        <input type="date" bind:value={birthDate} />
      </label>
    </div>

    {#if formError}
      <p class="error" role="alert">{formError}</p>
    {/if}

    <div class="actions">
      <button type="submit" class="btn-primary" disabled={saving}>
        {saving ? 'Wird gespeichert …' : 'Person anlegen'}
      </button>
      <a href={resolve('/persons')} class="btn-secondary">Abbrechen</a>
    </div>
  </form>
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
  }

  .btn-secondary:hover {
    background: var(--color-bg);
  }

  .error {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
    margin: 0;
  }
</style>
