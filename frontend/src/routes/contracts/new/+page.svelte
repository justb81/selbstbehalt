<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Neuer Vertrag (docs/design.md §6.1, issue #21): Form for creating a new contract.
  After creation the user is redirected to the detail page to add insured persons.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { contractTypeValues, type ContractType, type Person } from '@selbstbehalt/shared';

  const TYPE_LABELS: Record<ContractType, string> = {
    vollversicherung: 'Vollversicherung',
    zusatztarif: 'Zusatztarif',
    beihilfe: 'Beihilfe',
  };

  let persons = $state<Person[]>([]);
  let loadingPersons = $state(true);
  let personError = $state<string | null>(null);

  // Form fields
  let policyholderPersonId = $state('');
  let newPersonName = $state('');
  let useNewPerson = $state(false);
  let insurerName = $state('');
  let contractNumber = $state('');
  let type = $state<ContractType>('vollversicherung');
  let startDate = $state(new Date().toISOString().slice(0, 10));
  let endDate = $state('');
  let notes = $state('');

  let saving = $state(false);
  let formError = $state<string | null>(null);

  async function loadPersons() {
    loadingPersons = true;
    personError = null;
    try {
      persons = await api.persons.list();
    } catch {
      personError = 'Personen konnten nicht geladen werden.';
    } finally {
      loadingPersons = false;
    }
  }

  onMount(loadPersons);

  async function submit() {
    formError = null;
    if (!insurerName.trim()) {
      formError = 'Bitte den Versicherernamen eingeben.';
      return;
    }
    if (!useNewPerson && !policyholderPersonId) {
      formError = 'Bitte einen Versicherungsnehmer auswählen oder neu anlegen.';
      return;
    }
    if (useNewPerson && !newPersonName.trim()) {
      formError = 'Bitte den Namen der neuen Person eingeben.';
      return;
    }

    saving = true;
    try {
      let policyholderId = policyholderPersonId;

      if (useNewPerson) {
        const created = await api.persons.create({ name: newPersonName.trim() });
        policyholderId = created.id;
      }

      const contract = await api.contracts.create({
        policyholder_id: policyholderId,
        insurer_name: insurerName.trim(),
        contract_number: contractNumber.trim() || null,
        type,
        start_date: startDate,
        end_date: endDate.trim() || null,
        notes: notes.trim() || null,
      });

      await goto(resolve('/contracts/[id]', { id: contract.id }));
    } catch (e) {
      formError =
        e instanceof ApiError || e instanceof Error
          ? e.message
          : 'Vertrag konnte nicht gespeichert werden.';
      saving = false;
    }
  }
</script>

<svelte:head><title>Neuer Vertrag · selbstbehalt</title></svelte:head>

<section class="page">
  <div class="page-header">
    <a href={resolve('/contracts')} class="back-link">← Verträge</a>
    <h1>Neuer Vertrag</h1>
  </div>

  <form
    class="card"
    onsubmit={(e) => {
      e.preventDefault();
      void submit();
    }}
  >
    <h2>Vertragsdetails</h2>

    <div class="field-grid">
      <label class="field">
        <span>Versicherungsgesellschaft <span class="req">*</span></span>
        <input type="text" bind:value={insurerName} required placeholder="z.B. DEVK, Allianz …" />
      </label>

      <label class="field">
        <span>Vertragsart <span class="req">*</span></span>
        <select bind:value={type} required>
          {#each contractTypeValues as t (t)}
            <option value={t}>{TYPE_LABELS[t]}</option>
          {/each}
        </select>
      </label>

      <label class="field">
        <span>Vertragsnummer</span>
        <input type="text" bind:value={contractNumber} placeholder="optional" />
      </label>

      <label class="field">
        <span>Beginn <span class="req">*</span></span>
        <input type="date" bind:value={startDate} required />
      </label>

      <label class="field">
        <span>Ende</span>
        <input type="date" bind:value={endDate} />
      </label>
    </div>

    <label class="field">
      <span>Notizen</span>
      <textarea bind:value={notes} rows="3" placeholder="optional"></textarea>
    </label>

    <h2>Versicherungsnehmer <span class="req">*</span></h2>

    {#if loadingPersons}
      <p class="muted">Personen werden geladen …</p>
    {:else if personError}
      <p class="error">{personError}</p>
    {:else}
      <label class="checkbox-label">
        <input type="checkbox" bind:checked={useNewPerson} />
        <span>Neue Person anlegen</span>
      </label>

      {#if useNewPerson}
        <label class="field">
          <span>Name <span class="req">*</span></span>
          <input type="text" bind:value={newPersonName} placeholder="Vollständiger Name" />
        </label>
      {:else}
        <label class="field">
          <span>Person auswählen <span class="req">*</span></span>
          {#if persons.length === 0}
            <p class="muted">
              Noch keine Personen vorhanden.
              <button
                type="button"
                class="link"
                onclick={() => {
                  useNewPerson = true;
                }}>Neue Person anlegen</button
              >
            </p>
          {:else}
            <select bind:value={policyholderPersonId} required>
              <option value="" disabled>Bitte wählen …</option>
              {#each persons as person (person.id)}
                <option value={person.id}
                  >{person.name}{person.birth_date ? ` (geb. ${person.birth_date})` : ''}</option
                >
              {/each}
            </select>
          {/if}
        </label>
      {/if}
    {/if}

    {#if formError}
      <p class="error" role="alert">{formError}</p>
    {/if}

    <div class="actions">
      <button type="submit" class="btn-primary" disabled={saving}>
        {saving ? 'Wird gespeichert …' : 'Vertrag anlegen'}
      </button>
      <a href={resolve('/contracts')} class="btn-secondary">Abbrechen</a>
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

  h2 {
    margin: 0;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
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

  .field input,
  .field select,
  .field textarea {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font: inherit;
    color: var(--color-text);
    background: var(--color-bg);
    resize: vertical;
  }

  .field input:focus,
  .field select:focus,
  .field textarea:focus {
    outline: 2px solid var(--color-primary);
    outline-offset: 1px;
  }

  .req {
    color: var(--color-danger);
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-sm);
    cursor: pointer;
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

  .muted {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    margin: 0;
  }

  .error {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
    margin: 0;
  }

  .link {
    border: none;
    background: none;
    color: var(--color-primary);
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
  }
</style>
