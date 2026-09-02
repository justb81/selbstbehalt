<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Rechnungsarchiv (docs/architecture.md §5.2, issue #22): the full invoice list with
  Person/Status/Art filters and search via the shared InvoiceList component.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { api } from '$lib/api';
  import {
    paymentStatusValues,
    submissionStatusValues,
    type InsuredPerson,
    type Invoice,
    type Person,
  } from '@selbstbehalt/shared';
  import InvoiceList from '$lib/components/InvoiceList.svelte';
  import LoadingState from '$lib/components/LoadingState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import { partialFailureMessage, settledValues } from '$lib/utils/partial-load';
  import { readParam } from '$lib/utils/url-state';
  import { Button } from '@selbstbehalt/ui/button';

  let invoices = $state<Invoice[]>([]);
  let persons = $state<Person[]>([]);
  let insuredPersons = $state<InsuredPerson[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let filterWarning = $state<string | null>(null);

  // Deep-link filters, e.g. the dashboard's "Ausstehende Einreichungen" tile
  // linking to `?submission=eingereicht` (issue #261), or `?payment=offen`.
  // Read-only for now — the write-back lands with the InvoiceList rebuild (#466).
  const initialSubmission = $derived(
    readParam(page.url, 'submission', submissionStatusValues) ?? undefined,
  );
  const initialPayment = $derived(readParam(page.url, 'payment', paymentStatusValues) ?? undefined);

  async function load() {
    loading = true;
    error = null;
    filterWarning = null;
    try {
      const [invoiceList, personList, contractList] = await Promise.all([
        api.invoices.list(),
        api.persons.list(),
        api.contracts.list(),
      ]);
      invoices = invoiceList;
      persons = personList;
      // No "list all insured" endpoint — gather them per contract for the
      // invoice → person mapping the Person filter needs. Settled and outside
      // the spine: this feeds the *filter dropdown* only, and a `Promise.all`
      // here used to take the whole archive down with it — "Rechnungen konnten
      // nicht geladen werden.", with the invoices already sitting in state
      // (issue #396).
      const settled = await Promise.allSettled(contractList.map((c) => api.insured.list(c.id)));
      const lists = settledValues(settled);
      insuredPersons = lists.flatMap((list) => list ?? []);
      filterWarning = partialFailureMessage(
        lists.filter((l) => l === null).length,
        lists.length,
        'Personen-Filter',
      );
    } catch {
      error = 'Rechnungen konnten nicht geladen werden.';
    } finally {
      loading = false;
    }
  }

  onMount(load);
</script>

<svelte:head><title>Rechnungen · selbstbehalt</title></svelte:head>

<div class="container mx-auto max-w-5xl px-4 py-8 space-y-6">
  <div class="flex items-center justify-between flex-wrap gap-3">
    <h1 class="text-2xl font-bold tracking-tight">Rechnungen</h1>
    <Button href={resolve('/invoices/new')}>Rechnung erfassen</Button>
  </div>

  {#if loading}
    <LoadingState label="Rechnungen werden geladen …" />
  {:else if error}
    <ErrorState title="Fehler beim Laden" message={error} onRetry={load} />
  {:else}
    {#if filterWarning}
      <ErrorState title="Filter unvollständig" message={filterWarning} onRetry={load} />
    {/if}
    <InvoiceList
      {invoices}
      {persons}
      {insuredPersons}
      {initialPayment}
      {initialSubmission}
      newInvoiceHref={resolve('/invoices/new')}
    />
  {/if}
</div>
