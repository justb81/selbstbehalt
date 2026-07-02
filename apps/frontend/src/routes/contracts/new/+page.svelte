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
  import {
    contractTypeValues,
    formatDate,
    type ContractType,
    type Person,
  } from '@selbstbehalt/shared';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Card, CardContent } from '$lib/components/ui/card';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';

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

<div class="container mx-auto max-w-5xl px-4 py-8 space-y-6">
  <h1 class="text-2xl font-bold tracking-tight">Neuer Vertrag</h1>

  <form
    onsubmit={(e) => {
      e.preventDefault();
      void submit();
    }}
  >
    <Card>
      <CardContent class="pt-6 space-y-6">
        <div>
          <p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">
            Vertragsdetails
          </p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="space-y-1">
              <Label for="insurer"
                >Versicherungsgesellschaft <span class="text-destructive">*</span></Label
              >
              <Input
                id="insurer"
                type="text"
                bind:value={insurerName}
                required
                placeholder="z.B. DEVK, Allianz …"
              />
            </div>

            <div class="space-y-1">
              <Label for="type">Vertragsart <span class="text-destructive">*</span></Label>
              <select
                id="type"
                bind:value={type}
                required
                class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {#each contractTypeValues as t (t)}
                  <option value={t}>{TYPE_LABELS[t]}</option>
                {/each}
              </select>
            </div>

            <div class="space-y-1">
              <Label for="contractNumber">Vertragsnummer</Label>
              <Input
                id="contractNumber"
                type="text"
                bind:value={contractNumber}
                placeholder="optional"
              />
            </div>

            <div class="space-y-1">
              <Label for="startDate">Beginn <span class="text-destructive">*</span></Label>
              <Input id="startDate" type="date" bind:value={startDate} required />
            </div>

            <div class="space-y-1">
              <Label for="endDate">Ende</Label>
              <Input id="endDate" type="date" bind:value={endDate} />
            </div>
          </div>
        </div>

        <div class="space-y-1">
          <Label for="notes">Notizen</Label>
          <textarea
            id="notes"
            bind:value={notes}
            rows="3"
            placeholder="optional"
            class="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
          ></textarea>
        </div>

        <div class="space-y-3">
          <p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Versicherungsnehmer <span class="text-destructive">*</span>
          </p>

          {#if loadingPersons}
            <p class="text-sm text-muted-foreground">Personen werden geladen …</p>
          {:else if personError}
            <Alert variant="destructive">
              <AlertDescription>{personError}</AlertDescription>
            </Alert>
          {:else}
            <label class="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" bind:checked={useNewPerson} class="rounded" />
              <span>Neue Person anlegen</span>
            </label>

            {#if useNewPerson}
              <div class="space-y-1">
                <Label for="newName">Name <span class="text-destructive">*</span></Label>
                <Input
                  id="newName"
                  type="text"
                  bind:value={newPersonName}
                  placeholder="Vollständiger Name"
                />
              </div>
            {:else}
              <div class="space-y-1">
                <Label for="person">Person auswählen <span class="text-destructive">*</span></Label>
                {#if persons.length === 0}
                  <p class="text-sm text-muted-foreground">
                    Noch keine Personen vorhanden.
                    <button
                      type="button"
                      class="text-primary underline cursor-pointer bg-transparent border-none p-0 font-inherit"
                      onclick={() => {
                        useNewPerson = true;
                      }}
                    >
                      Neue Person anlegen
                    </button>
                  </p>
                {:else}
                  <select
                    id="person"
                    bind:value={policyholderPersonId}
                    required
                    class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="" disabled>Bitte wählen …</option>
                    {#each persons as person (person.id)}
                      <option value={person.id}>
                        {person.name}{person.birth_date
                          ? ` (geb. ${formatDate(person.birth_date)})`
                          : ''}
                      </option>
                    {/each}
                  </select>
                {/if}
              </div>
            {/if}
          {/if}
        </div>

        {#if formError}
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        {/if}

        <div class="flex flex-wrap gap-2 items-center">
          <Button type="submit" disabled={saving}>
            {saving ? 'Wird gespeichert …' : 'Vertrag anlegen'}
          </Button>
          <Button variant="outline" href={resolve('/contracts')}>Abbrechen</Button>
        </div>
      </CardContent>
    </Card>
  </form>
</div>
