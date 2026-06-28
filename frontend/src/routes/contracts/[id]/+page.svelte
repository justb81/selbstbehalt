<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Contract detail (docs/design.md §6.1, issue #21): shows contract info,
  manages insured persons, and renders a BRETracker per person.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import {
    contractTypeValues,
    formatEur,
    type BRELevel,
    type BREStructure,
    type Contract,
    type ContractType,
    type InsuredPerson,
    type Person,
  } from '@selbstbehalt/shared';
  import BRETracker from '$lib/components/BRETracker.svelte';
  import LoadingState from '$lib/components/LoadingState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';

  const TYPE_LABELS: Record<ContractType, string> = {
    vollversicherung: 'Vollversicherung',
    zusatztarif: 'Zusatztarif',
    beihilfe: 'Beihilfe',
  };

  const contractId = $derived(page.params.id as string);

  let contract = $state<Contract | null>(null);
  let insuredPersons = $state<InsuredPerson[]>([]);
  let persons = $state<Person[]>([]);
  let loading = $state(true);
  let loadError = $state<string | null>(null);

  async function load() {
    loading = true;
    loadError = null;
    try {
      const [c, ip, ps] = await Promise.all([
        api.contracts.get(contractId),
        api.insured.list(contractId),
        api.persons.list(),
      ]);
      contract = c;
      insuredPersons = ip;
      persons = ps;
    } catch (e) {
      loadError = e instanceof ApiError || e instanceof Error ? e.message : 'Laden fehlgeschlagen.';
    } finally {
      loading = false;
    }
  }

  onMount(load);

  // ---- Contract edit ----
  let editingContract = $state(false);
  let editInsurer = $state('');
  let editContractNumber = $state('');
  let editType = $state<ContractType>('vollversicherung');
  let editStartDate = $state('');
  let editEndDate = $state('');
  let editNotes = $state('');
  let savingContract = $state(false);
  let contractSaveError = $state<string | null>(null);

  function startEditContract() {
    if (!contract) return;
    editInsurer = contract.insurer_name;
    editContractNumber = contract.contract_number ?? '';
    editType = contract.type;
    editStartDate = contract.start_date;
    editEndDate = contract.end_date ?? '';
    editNotes = contract.notes ?? '';
    editingContract = true;
    contractSaveError = null;
  }

  async function saveContract() {
    if (!contract) return;
    savingContract = true;
    contractSaveError = null;
    try {
      contract = await api.contracts.update(contract.id, {
        insurer_name: editInsurer.trim(),
        contract_number: editContractNumber.trim() || null,
        type: editType,
        start_date: editStartDate,
        end_date: editEndDate.trim() || null,
        notes: editNotes.trim() || null,
      });
      editingContract = false;
    } catch (e) {
      contractSaveError =
        e instanceof ApiError || e instanceof Error ? e.message : 'Speichern fehlgeschlagen.';
    } finally {
      savingContract = false;
    }
  }

  // ---- Delete contract ----
  let deletingContract = $state(false);
  let confirmDelete = $state(false);

  async function deleteContract() {
    if (!contract) return;
    deletingContract = true;
    try {
      await api.contracts.remove(contract.id);
      await goto(resolve('/contracts'));
    } catch (e) {
      loadError =
        e instanceof ApiError || e instanceof Error ? e.message : 'Löschen fehlgeschlagen.';
      deletingContract = false;
      confirmDelete = false;
    }
  }

  // ---- Insured person form ----
  let showInsuredForm = $state(false);
  let editInsuredId = $state<string | null>(null);

  let ipPersonId = $state('');
  let ipKvnr = $state('');
  let ipTariffName = $state('');
  let ipMonthlyPremium = $state<number>(0);
  let ipSelfRetention = $state<number>(0);
  let ipStartDate = $state('');
  let ipEndDate = $state('');
  let ipNotes = $state('');

  // BRE structure
  let ipHasBre = $state(false);
  let ipStreakStart = $state('');
  let ipBreLevels = $state<
    { leistungsfrei_months: number; bre_months: number; pct_of_premium: number }[]
  >([{ leistungsfrei_months: 12, bre_months: 1, pct_of_premium: 100 }]);

  let savingInsured = $state(false);
  let insuredSaveError = $state<string | null>(null);

  function addBreLevel() {
    ipBreLevels = [
      ...ipBreLevels,
      { leistungsfrei_months: 24, bre_months: 2, pct_of_premium: 100 },
    ];
  }

  function removeBreLevel(i: number) {
    ipBreLevels = ipBreLevels.filter((_, idx) => idx !== i);
  }

  function openNewInsuredForm() {
    editInsuredId = null;
    ipPersonId = '';
    ipKvnr = '';
    ipTariffName = '';
    ipMonthlyPremium = 0;
    ipSelfRetention = 0;
    ipStartDate = '';
    ipEndDate = '';
    ipNotes = '';
    ipHasBre = false;
    ipStreakStart = '';
    ipBreLevels = [{ leistungsfrei_months: 12, bre_months: 1, pct_of_premium: 100 }];
    insuredSaveError = null;
    showInsuredForm = true;
  }

  function openEditInsuredForm(ip: InsuredPerson) {
    editInsuredId = ip.id;
    ipPersonId = ip.person_id;
    ipKvnr = ip.kvnr ?? '';
    ipTariffName = ip.tariff_name ?? '';
    ipMonthlyPremium = ip.monthly_premium;
    ipSelfRetention = ip.self_retention;
    ipStartDate = ip.start_date ?? '';
    ipEndDate = ip.end_date ?? '';
    ipNotes = ip.notes ?? '';
    if (ip.bre_structure) {
      ipHasBre = true;
      ipStreakStart = ip.bre_structure.current_streak_start ?? '';
      ipBreLevels = ip.bre_structure.levels.map((l) => ({ ...l }));
    } else {
      ipHasBre = false;
      ipStreakStart = '';
      ipBreLevels = [{ leistungsfrei_months: 12, bre_months: 1, pct_of_premium: 100 }];
    }
    insuredSaveError = null;
    showInsuredForm = true;
  }

  function cancelInsuredForm() {
    showInsuredForm = false;
    editInsuredId = null;
  }

  async function saveInsuredPerson() {
    if (!ipPersonId) {
      insuredSaveError = 'Bitte eine Person auswählen.';
      return;
    }
    if (!(ipMonthlyPremium > 0)) {
      insuredSaveError = 'Bitte einen Monatsbeitrag (> 0) eingeben.';
      return;
    }

    const breStructure: BREStructure | null = ipHasBre
      ? {
          type: 'staffel',
          levels: ipBreLevels as BRELevel[],
          current_streak_start: ipStreakStart || null,
        }
      : null;

    const body = {
      person_id: ipPersonId,
      kvnr: ipKvnr.trim() || null,
      tariff_name: ipTariffName.trim() || null,
      monthly_premium: ipMonthlyPremium,
      self_retention: ipSelfRetention,
      bre_structure: breStructure,
      included_benefits: null,
      start_date: ipStartDate.trim() || null,
      end_date: ipEndDate.trim() || null,
      notes: ipNotes.trim() || null,
    };

    savingInsured = true;
    insuredSaveError = null;
    try {
      if (editInsuredId) {
        const updated = await api.insured.update(editInsuredId, body);
        insuredPersons = insuredPersons.map((ip) => (ip.id === editInsuredId ? updated : ip));
      } else {
        const created = await api.insured.create(contractId, body);
        insuredPersons = [...insuredPersons, created];
      }
      showInsuredForm = false;
      editInsuredId = null;
    } catch (e) {
      insuredSaveError =
        e instanceof ApiError || e instanceof Error ? e.message : 'Speichern fehlgeschlagen.';
    } finally {
      savingInsured = false;
    }
  }

  async function removeInsured(insuredId: string) {
    if (
      !confirm('Versicherte Person wirklich entfernen? Alle zugehörigen Rechnungen gehen verloren.')
    )
      return;
    try {
      await api.insured.remove(insuredId);
      insuredPersons = insuredPersons.filter((ip) => ip.id !== insuredId);
    } catch (e) {
      loadError =
        e instanceof ApiError || e instanceof Error ? e.message : 'Löschen fehlgeschlagen.';
    }
  }

  function personName(personId: string): string {
    return persons.find((p) => p.id === personId)?.name ?? personId;
  }
</script>

<svelte:head>
  <title>{contract ? `${contract.insurer_name} · Vertrag` : 'Vertragsdetail'} · selbstbehalt</title>
</svelte:head>

<section class="page">
  <div class="back-row">
    <a href={resolve('/contracts')} class="back-link">← Verträge</a>
  </div>

  <h1 class="page-title">{contract?.insurer_name ?? 'Vertragsdetail'}</h1>

  {#if loading}
    <LoadingState label="Vertragsdaten werden geladen …" />
  {:else if loadError}
    <ErrorState title="Fehler" message={loadError} onRetry={load} />
  {:else if contract}
    <!-- Contract header -->
    <div class="contract-header">
      <div>
        <span class="type-badge">{TYPE_LABELS[contract.type]}</span>
        {#if contract.contract_number}
          <span class="contract-number">Nr. {contract.contract_number}</span>
        {/if}
      </div>
      <div class="header-actions">
        <button type="button" class="btn-secondary" onclick={startEditContract}>Bearbeiten</button>
        <button
          type="button"
          class="btn-danger-outline"
          onclick={() => {
            confirmDelete = true;
          }}
        >
          Löschen
        </button>
      </div>
    </div>

    <div class="meta-row">
      <span>Versicherungsnehmer: <strong>{personName(contract.policyholder_id)}</strong></span>
      <span>seit {contract.start_date}{contract.end_date ? ` bis ${contract.end_date}` : ''}</span>
    </div>

    {#if contract.notes}
      <p class="notes">{contract.notes}</p>
    {/if}

    {#if confirmDelete}
      <div class="confirm-dialog" role="alertdialog">
        <p>
          Vertrag <strong>{contract.insurer_name}</strong> wirklich löschen? Alle versicherten Personen
          und deren Rechnungen werden unwiderruflich entfernt.
        </p>
        <div class="actions">
          <button
            type="button"
            class="btn-danger"
            onclick={deleteContract}
            disabled={deletingContract}
          >
            {deletingContract ? 'Wird gelöscht …' : 'Ja, löschen'}
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
        </div>
      </div>
    {/if}

    <!-- Insured persons -->
    <div class="section-header">
      <h2>Versicherte Personen</h2>
      <button type="button" class="btn-primary" onclick={openNewInsuredForm}>
        + Person hinzufügen
      </button>
    </div>

    {#if insuredPersons.length === 0}
      <p class="muted">Noch keine versicherten Personen. Bitte mindestens eine hinzufügen.</p>
    {:else}
      <div class="insured-list">
        {#each insuredPersons as ip (ip.id)}
          <div class="insured-card">
            <div class="insured-header">
              <div>
                <strong>{ip.tariff_name ?? 'Tarif nicht angegeben'}</strong>
                <span class="insured-meta">
                  {personName(ip.person_id)}
                  {#if ip.kvnr}
                    · KVNR: {ip.kvnr}{/if}
                </span>
              </div>
              <div class="insured-actions">
                <span class="premium">{formatEur(ip.monthly_premium)} / Monat</span>
                {#if ip.self_retention > 0}
                  <span class="retention">SB: {formatEur(ip.self_retention)}</span>
                {/if}
                <button
                  type="button"
                  class="btn-icon"
                  title="Bearbeiten"
                  onclick={() => openEditInsuredForm(ip)}
                >
                  ✎
                </button>
                <button
                  type="button"
                  class="btn-icon danger"
                  title="Entfernen"
                  onclick={() => void removeInsured(ip.id)}
                >
                  ✕
                </button>
              </div>
            </div>

            <BRETracker insuredPerson={ip} />
          </div>
        {/each}
      </div>
    {/if}

    <!-- Insured person form -->
    {#if showInsuredForm}
      <div class="insured-form-card">
        <h2>{editInsuredId ? 'Versicherte Person bearbeiten' : 'Neue versicherte Person'}</h2>

        <form
          onsubmit={(e) => {
            e.preventDefault();
            void saveInsuredPerson();
          }}
        >
          <div class="field-grid">
            <label class="field">
              <span>Person <span class="req">*</span></span>
              <select bind:value={ipPersonId} required>
                <option value="" disabled>Bitte wählen …</option>
                {#each persons as person (person.id)}
                  <option value={person.id}>{person.name}</option>
                {/each}
              </select>
            </label>

            <label class="field">
              <span>KVNR</span>
              <input type="text" bind:value={ipKvnr} placeholder="optional" />
            </label>

            <label class="field">
              <span>Tarifname</span>
              <input type="text" bind:value={ipTariffName} placeholder="optional" />
            </label>

            <label class="field">
              <span>Monatsbeitrag (€) <span class="req">*</span></span>
              <input type="number" bind:value={ipMonthlyPremium} min="0" step="0.01" required />
            </label>

            <label class="field">
              <span>Jährlicher Selbstbehalt (€)</span>
              <input type="number" bind:value={ipSelfRetention} min="0" step="0.01" />
            </label>

            <label class="field">
              <span>Tarifbeginn</span>
              <input type="date" bind:value={ipStartDate} />
            </label>

            <label class="field">
              <span>Tarifende</span>
              <input type="date" bind:value={ipEndDate} />
            </label>
          </div>

          <label class="field full">
            <span>Notizen</span>
            <textarea bind:value={ipNotes} rows="2"></textarea>
          </label>

          <!-- BRE Structure -->
          <div class="bre-section">
            <label class="checkbox-label">
              <input type="checkbox" bind:checked={ipHasBre} />
              <span>BRE-Staffel konfigurieren</span>
            </label>

            {#if ipHasBre}
              <label class="field">
                <span>Leistungsfreiheit begann am</span>
                <input type="date" bind:value={ipStreakStart} />
              </label>

              <div class="bre-levels">
                <div class="bre-levels-head">
                  <span>Leistungsfreie Monate</span>
                  <span>BRE-Monate</span>
                  <span>Anteil (%)</span>
                  <span></span>
                </div>
                {#each ipBreLevels as level, i (i)}
                  <div class="bre-level-row">
                    <input
                      type="number"
                      bind:value={level.leistungsfrei_months}
                      min="1"
                      step="1"
                      required
                    />
                    <input
                      type="number"
                      bind:value={level.bre_months}
                      min="0"
                      step="0.5"
                      required
                    />
                    <input
                      type="number"
                      bind:value={level.pct_of_premium}
                      min="0"
                      max="100"
                      step="1"
                      required
                    />
                    <button
                      type="button"
                      class="btn-icon danger"
                      onclick={() => removeBreLevel(i)}
                      disabled={ipBreLevels.length <= 1}
                    >
                      ✕
                    </button>
                  </div>
                {/each}
                <button type="button" class="btn-text" onclick={addBreLevel}>
                  + Stufe hinzufügen
                </button>
              </div>
            {/if}
          </div>

          {#if insuredSaveError}
            <p class="error" role="alert">{insuredSaveError}</p>
          {/if}

          <div class="actions">
            <button type="submit" class="btn-primary" disabled={savingInsured}>
              {savingInsured ? 'Wird gespeichert …' : editInsuredId ? 'Speichern' : 'Hinzufügen'}
            </button>
            <button type="button" class="btn-secondary" onclick={cancelInsuredForm}>
              Abbrechen
            </button>
          </div>
        </form>
      </div>
    {/if}
  {/if}

  <!-- Contract edit modal (inline) -->
  {#if editingContract && contract}
    <div class="edit-overlay">
      <div class="edit-card">
        <h2>Vertrag bearbeiten</h2>
        <form
          onsubmit={(e) => {
            e.preventDefault();
            void saveContract();
          }}
        >
          <div class="field-grid">
            <label class="field">
              <span>Versicherungsgesellschaft <span class="req">*</span></span>
              <input type="text" bind:value={editInsurer} required />
            </label>
            <label class="field">
              <span>Vertragsart</span>
              <select bind:value={editType}>
                {#each contractTypeValues as t (t)}
                  <option value={t}>{TYPE_LABELS[t]}</option>
                {/each}
              </select>
            </label>
            <label class="field">
              <span>Vertragsnummer</span>
              <input type="text" bind:value={editContractNumber} />
            </label>
            <label class="field">
              <span>Beginn</span>
              <input type="date" bind:value={editStartDate} required />
            </label>
            <label class="field">
              <span>Ende</span>
              <input type="date" bind:value={editEndDate} />
            </label>
          </div>
          <label class="field full">
            <span>Notizen</span>
            <textarea bind:value={editNotes} rows="2"></textarea>
          </label>

          {#if contractSaveError}
            <p class="error" role="alert">{contractSaveError}</p>
          {/if}

          <div class="actions">
            <button type="submit" class="btn-primary" disabled={savingContract}>
              {savingContract ? 'Wird gespeichert …' : 'Speichern'}
            </button>
            <button
              type="button"
              class="btn-secondary"
              onclick={() => {
                editingContract = false;
              }}
            >
              Abbrechen
            </button>
          </div>
        </form>
      </div>
    </div>
  {/if}
</section>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .back-link {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    text-decoration: none;
  }
  .back-link:hover {
    color: var(--color-primary);
  }

  .contract-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  h1 {
    margin: 0 0 var(--space-1);
  }
  h2 {
    margin: 0;
  }

  .type-badge {
    display: inline-flex;
    padding: 0.1em 0.6em;
    border-radius: 999px;
    font-size: var(--font-size-sm);
    font-weight: 500;
    background: var(--color-primary-soft);
    color: var(--color-primary-strong);
    margin-right: var(--space-2);
  }

  .contract-number {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .header-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .meta-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .notes {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    margin: 0;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
    margin-top: var(--space-3);
  }

  .insured-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .insured-card {
    padding: var(--space-4);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    box-shadow: var(--shadow-sm);
  }

  .insured-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .insured-meta {
    display: block;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    font-weight: 400;
  }

  .insured-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .premium {
    font-weight: 600;
    color: var(--color-text);
  }

  .retention {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .insured-form-card {
    padding: var(--space-4);
    background: var(--color-surface);
    border: 2px solid var(--color-primary);
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    box-shadow: var(--shadow-md);
  }

  .insured-form-card form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .field-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
    gap: var(--space-3);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .field.full {
    grid-column: 1 / -1;
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

  .bre-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--color-bg);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
  }

  .bre-levels {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .bre-levels-head {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 2rem;
    gap: var(--space-2);
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    font-weight: 600;
  }

  .bre-level-row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 2rem;
    gap: var(--space-2);
    align-items: center;
  }

  .bre-level-row input {
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font: inherit;
    min-width: 0;
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
    padding: var(--space-2) var(--space-4);
    border: none;
    border-radius: var(--radius-sm);
    background: var(--color-primary);
    color: var(--color-primary-contrast);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
  }
  .btn-primary:hover:not(:disabled) {
    background: var(--color-primary-strong);
  }

  .btn-secondary {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
  }
  .btn-secondary:hover:not(:disabled) {
    background: var(--color-bg);
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
    background: color-mix(in srgb, var(--color-danger) 8%, white);
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

  .btn-icon {
    width: 2rem;
    height: 2rem;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--color-bg);
    color: var(--color-text-muted);
    font: inherit;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .btn-icon:hover {
    color: var(--color-primary);
    background: var(--color-primary-soft);
  }
  .btn-icon.danger:hover {
    color: var(--color-danger);
    background: color-mix(in srgb, var(--color-danger) 10%, white);
  }
  .btn-icon:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-text {
    border: none;
    background: none;
    color: var(--color-primary);
    font: inherit;
    font-size: var(--font-size-sm);
    cursor: pointer;
    padding: 0;
    text-decoration: underline;
    align-self: flex-start;
  }

  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
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

  .confirm-dialog {
    padding: var(--space-4);
    background: color-mix(in srgb, var(--color-danger) 5%, var(--color-surface));
    border: 1px solid color-mix(in srgb, var(--color-danger) 40%, var(--color-border));
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .confirm-dialog p {
    margin: 0;
    font-size: var(--font-size-sm);
    line-height: 1.6;
  }

  .back-row {
    margin-bottom: var(--space-1);
  }

  .edit-overlay {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    z-index: 100;
  }

  .edit-card {
    background: var(--color-surface);
    border-radius: var(--radius-lg);
    padding: var(--space-5);
    width: 100%;
    max-width: 36rem;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    box-shadow: var(--shadow-md);
  }

  .edit-card form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
</style>
