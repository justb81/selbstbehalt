<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Rechnungsarchiv (docs/design.md §6.1, issue #22): the full invoice list with
  Person/Status/Art filters and search via the shared InvoiceList component.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { api } from '$lib/api';
  import type { InsuredPerson, Invoice, Person } from '@selbstbehalt/shared';
  import InvoiceList from '$lib/components/InvoiceList.svelte';
  import LoadingState from '$lib/components/LoadingState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import { Button } from '$lib/components/ui/button';

  let invoices = $state<Invoice[]>([]);
  let persons = $state<Person[]>([]);
  let insuredPersons = $state<InsuredPerson[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function load() {
    loading = true;
    error = null;
    try {
      const [invoiceList, personList, contractList] = await Promise.all([
        api.invoices.list(),
        api.persons.list(),
        api.contracts.list(),
      ]);
      invoices = invoiceList;
      persons = personList;
      // No "list all insured" endpoint — gather them per contract for the
      // invoice → person mapping the Person filter needs.
      const insuredLists = await Promise.all(contractList.map((c) => api.insured.list(c.id)));
      insuredPersons = insuredLists.flat();
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
    <InvoiceList {invoices} {persons} {insuredPersons} newInvoiceHref={resolve('/invoices/new')} />
  {/if}
</div>
