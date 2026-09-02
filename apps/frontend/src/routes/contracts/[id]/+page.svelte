<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Contract detail (docs/architecture.md §5.2, issue #21): shows contract info,
  manages insured persons, and renders a BRETracker per person.

  Loading, the insured-person list and the two destructive confirmations live
  here; the forms are components (issues #445/#465): `ContractEditDialog`,
  `InsuredPersonForm` and, embedded in the latter, `IncludedBenefitsEditor`.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import {
    CONTRACT_TYPE_LABELS,
    formatDate,
    formatEur,
    insuredPersonLabel,
    type Contract,
    type InsuredPerson,
    type Person,
  } from '@selbstbehalt/shared';
  import { setBreadcrumbEntity } from '$lib/stores/breadcrumb';
  import { destructiveOutlineClass } from '$lib/utils/button-variants';
  import BRETracker from '$lib/components/BRETracker.svelte';
  import ContractEditDialog from '$lib/components/ContractEditDialog.svelte';
  import InsuredPersonForm from '$lib/components/InsuredPersonForm.svelte';
  import LoadingState from '$lib/components/LoadingState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import PencilIcon from '@lucide/svelte/icons/pencil';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import { Button } from '@selbstbehalt/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Card, CardContent } from '@selbstbehalt/ui/card';
  import { Alert, AlertDescription } from '@selbstbehalt/ui/alert';
  import {
    AlertDialogRoot,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogFooter,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogAction,
    AlertDialogCancel,
  } from '$lib/components/ui/alert-dialog';

  const contractId = $derived(page.params.id as string);

  let contract = $state<Contract | null>(null);
  let insuredPersons = $state<InsuredPerson[]>([]);
  let persons = $state<Person[]>([]);
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  // Failures of an action on loaded data stay inline — replacing the whole page
  // with an `ErrorState` would throw away the list the user is working on.
  let actionError = $state<string | null>(null);

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

  // Feed the real insurer name into the global breadcrumb once it has loaded.
  $effect(() => {
    if (contract) setBreadcrumbEntity(contractId, contract.insurer_name);
  });

  let editingContract = $state(false);

  // ---- Delete contract ----
  let deletingContract = $state(false);
  let confirmDelete = $state(false);

  async function deleteContract() {
    if (!contract) return;
    deletingContract = true;
    actionError = null;
    try {
      await api.contracts.remove(contract.id);
      await goto(resolve('/contracts'));
    } catch (e) {
      actionError =
        e instanceof ApiError || e instanceof Error ? e.message : 'Löschen fehlgeschlagen.';
      deletingContract = false;
      confirmDelete = false;
    }
  }

  // ---- Insured persons ----
  let showInsuredForm = $state(false);
  let editInsured = $state<InsuredPerson | null>(null);
  /** Key that remounts `InsuredPersonForm` — it reads its props once. */
  let formKey = $state(0);

  function openInsuredForm(insured: InsuredPerson | null) {
    editInsured = insured;
    showInsuredForm = true;
    formKey += 1;
  }

  function onInsuredSaved(saved: InsuredPerson) {
    insuredPersons = insuredPersons.some((ip) => ip.id === saved.id)
      ? insuredPersons.map((ip) => (ip.id === saved.id ? saved : ip))
      : [...insuredPersons, saved];
    showInsuredForm = false;
    editInsured = null;
  }

  let insuredPendingRemoval = $state<InsuredPerson | null>(null);
  let removingInsuredId = $state<string | null>(null);

  async function removeInsured(insuredId: string) {
    removingInsuredId = insuredId;
    actionError = null;
    try {
      await api.insured.remove(insuredId);
      insuredPersons = insuredPersons.filter((ip) => ip.id !== insuredId);
      insuredPendingRemoval = null;
    } catch (e) {
      actionError =
        e instanceof ApiError || e instanceof Error ? e.message : 'Löschen fehlgeschlagen.';
      insuredPendingRemoval = null;
    } finally {
      removingInsuredId = null;
    }
  }

  function personName(personId: string): string {
    return persons.find((p) => p.id === personId)?.name ?? personId;
  }
</script>

<svelte:head>
  <title>{contract ? `${contract.insurer_name} · Vertrag` : 'Vertragsdetail'} · selbstbehalt</title>
</svelte:head>

<div class="container mx-auto max-w-5xl space-y-6 px-4 py-8">
  <h1 class="text-2xl font-bold tracking-tight">
    {contract?.insurer_name ?? 'Vertragsdetail'}
  </h1>

  {#if loading}
    <LoadingState label="Vertragsdaten werden geladen …" />
  {:else if loadError}
    <ErrorState title="Fehler" message={loadError} onRetry={load} />
  {:else if contract}
    <!-- Contract header -->
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{CONTRACT_TYPE_LABELS[contract.type]}</Badge>
        {#if contract.contract_number}
          <span class="text-sm text-muted-foreground">Nr. {contract.contract_number}</span>
        {/if}
      </div>
      <div class="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onclick={() => {
            editingContract = true;
          }}
        >
          Bearbeiten
        </Button>
        <Button
          variant="outline"
          size="sm"
          class={destructiveOutlineClass}
          onclick={() => {
            confirmDelete = true;
          }}
        >
          Löschen
        </Button>
      </div>
    </div>

    <div class="flex flex-wrap gap-4 text-sm text-muted-foreground">
      <span>
        Versicherungsnehmer:
        <strong class="text-foreground">{personName(contract.policyholder_id)}</strong>
      </span>
      <span>
        seit {formatDate(contract.start_date)}{contract.end_date
          ? ` bis ${formatDate(contract.end_date)}`
          : ''}
      </span>
    </div>

    {#if contract.notes}
      <p class="text-sm text-muted-foreground">{contract.notes}</p>
    {/if}

    {#if editingContract}
      <ContractEditDialog
        bind:open={editingContract}
        {contract}
        onsaved={(updated) => {
          contract = updated;
        }}
      />
    {/if}

    <AlertDialogRoot bind:open={confirmDelete}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Vertrag löschen?</AlertDialogTitle>
          <AlertDialogDescription>
            Vertrag <strong>{contract.insurer_name}</strong> wirklich löschen? Alle versicherten Personen
            und deren Rechnungen werden unwiderruflich entfernt.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onclick={deleteContract}
            disabled={deletingContract}
          >
            {deletingContract ? 'Wird gelöscht …' : 'Ja, löschen'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialogRoot>

    <AlertDialogRoot
      open={insuredPendingRemoval !== null}
      onOpenChange={(open) => {
        if (!open) insuredPendingRemoval = null;
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Versicherte Person entfernen?</AlertDialogTitle>
          <AlertDialogDescription>
            Versicherte Person wirklich entfernen? Alle zugehörigen Rechnungen gehen verloren.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={removingInsuredId !== null}
            onclick={() => insuredPendingRemoval && void removeInsured(insuredPendingRemoval.id)}
          >
            {removingInsuredId !== null ? 'Wird entfernt …' : 'Ja, entfernen'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialogRoot>

    <!-- Insured persons -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg font-semibold">Versicherte Personen</h2>
      <Button size="sm" onclick={() => openInsuredForm(null)}>+ Person hinzufügen</Button>
    </div>

    {#if actionError}
      <Alert variant="destructive">
        <AlertDescription>{actionError}</AlertDescription>
      </Alert>
    {/if}

    {#if insuredPersons.length === 0}
      <EmptyState
        compact
        message="Noch keine versicherten Personen. Bitte mindestens eine hinzufügen."
      />
    {:else}
      <div class="space-y-3">
        {#each insuredPersons as ip (ip.id)}
          <Card>
            <CardContent class="space-y-3 pt-4">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
                  <a
                    href={resolve('/insured/[id]', { id: ip.id })}
                    class="font-semibold transition-colors hover:text-primary hover:underline"
                  >
                    {insuredPersonLabel(ip)}
                  </a>
                  <p class="text-sm text-muted-foreground">
                    {ip.tariff_name ?? 'Tarif nicht angegeben'}{#if ip.kvnr}
                      · KVNR: {ip.kvnr}{/if}
                  </p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-sm font-semibold">{formatEur(ip.monthly_premium)} / Monat</span>
                  {#if ip.self_retention > 0}
                    <span class="text-sm text-muted-foreground">
                      SB: {formatEur(ip.self_retention)}
                    </span>
                  {/if}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="{insuredPersonLabel(ip)} bearbeiten"
                    onclick={() => openInsuredForm(ip)}
                  >
                    <PencilIcon class="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="{insuredPersonLabel(ip)} entfernen"
                    onclick={() => {
                      insuredPendingRemoval = ip;
                    }}
                  >
                    <Trash2Icon class="size-4" />
                  </Button>
                </div>
              </div>
              <BRETracker
                insuredPerson={ip}
                compact={true}
                href={resolve('/insured/[id]', { id: ip.id })}
              />
            </CardContent>
          </Card>
        {/each}
      </div>
    {/if}

    {#if showInsuredForm}
      {#key formKey}
        <InsuredPersonForm
          {contractId}
          insured={editInsured}
          {persons}
          onsaved={onInsuredSaved}
          oncancel={() => {
            showInsuredForm = false;
            editInsured = null;
          }}
        />
      {/key}
    {/if}
  {/if}
</div>
