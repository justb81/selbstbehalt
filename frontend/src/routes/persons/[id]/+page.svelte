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
  import { formatDate } from '@selbstbehalt/shared';
  import LoadingState from '$lib/components/LoadingState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Card, CardContent } from '$lib/components/ui/card';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';

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

<div class="container mx-auto max-w-5xl px-4 py-8 space-y-6">
  <h1 class="text-2xl font-bold tracking-tight">Personendetail</h1>

  {#if loading}
    <LoadingState label="Person wird geladen …" />
  {:else if loadError}
    <ErrorState title="Fehler beim Laden" message={loadError} onRetry={load} />
  {:else if person}
    {#if editing}
      <form
        onsubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Card>
          <CardContent class="pt-6 space-y-4">
            <p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Person bearbeiten
            </p>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div class="space-y-1">
                <Label for="editName">Name <span class="text-destructive">*</span></Label>
                <Input id="editName" type="text" bind:value={editName} required />
              </div>

              <div class="space-y-1">
                <Label for="editBirthDate">Geburtsdatum</Label>
                <Input id="editBirthDate" type="date" bind:value={editBirthDate} />
              </div>
            </div>

            {#if saveError}
              <Alert variant="destructive">
                <AlertDescription>{saveError}</AlertDescription>
              </Alert>
            {/if}

            <div class="flex flex-wrap gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? 'Wird gespeichert …' : 'Speichern'}
              </Button>
              <Button type="button" variant="outline" onclick={cancelEdit} disabled={saving}>
                Abbrechen
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    {:else}
      <Card>
        <CardContent class="pt-6 space-y-6">
          <div class="flex flex-wrap gap-6">
            <div>
              <p class="text-xs text-muted-foreground mb-1">Name</p>
              <p class="font-semibold">{person.name}</p>
            </div>
            {#if person.birth_date}
              <div>
                <p class="text-xs text-muted-foreground mb-1">Geburtsdatum</p>
                <p class="font-semibold">{formatDate(person.birth_date)}</p>
              </div>
            {/if}
          </div>

          <div class="flex flex-wrap gap-2 items-center">
            <Button variant="outline" onclick={startEdit}>Bearbeiten</Button>
            <Button variant="outline" href={resolve('/contracts')}>Verträge anzeigen</Button>
            {#if confirmDelete}
              <span class="text-sm text-destructive">Wirklich löschen?</span>
              <Button variant="destructive" disabled={deleting} onclick={() => void deletePerson()}>
                {deleting ? 'Wird gelöscht …' : 'Ja, löschen'}
              </Button>
              <Button
                variant="outline"
                onclick={() => {
                  confirmDelete = false;
                }}>Abbrechen</Button
              >
            {:else}
              <Button
                variant="outline"
                class="border-destructive text-destructive hover:bg-destructive/10"
                onclick={() => {
                  confirmDelete = true;
                }}
              >
                Löschen
              </Button>
            {/if}
          </div>
        </CardContent>
      </Card>
    {/if}
  {/if}
</div>
