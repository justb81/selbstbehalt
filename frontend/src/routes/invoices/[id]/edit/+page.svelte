<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Rechnungsbearbeitung (issue #119): edit a saved invoice's header fields and
  positions, and re-validate positions against the Gebührenordnung. Only
  invoices with status 'neu', 'geprüft', or 'selbst_gezahlt' are editable
  (before any formal submission to the insurer).
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import type { InsuredPerson, InvoiceWithPositions } from '@selbstbehalt/shared';
  import InvoiceForm from '$lib/components/InvoiceForm.svelte';
  import type { FormPayload } from '$lib/components/InvoiceForm.svelte';
  import LoadingState from '$lib/components/LoadingState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent } from '$lib/components/ui/card';

  const EDITABLE_STATUSES = new Set(['neu', 'geprüft', 'selbst_gezahlt']);

  const invoiceId = $derived(page.params.id as string);

  type InsuredOption = { id: string; label: string; insuredPerson: InsuredPerson };

  let invoice = $state<InvoiceWithPositions | null>(null);
  let insuredOptions = $state<InsuredOption[]>([]);
  let loading = $state(true);
  let loadError = $state<string | null>(null);

  async function load() {
    loading = true;
    loadError = null;
    try {
      const [inv, contracts] = await Promise.all([
        api.invoices.get(invoiceId),
        api.contracts.list(),
      ]);
      invoice = inv;
      const lists = await Promise.all(
        contracts.map(async (c) => {
          const persons = await api.insured.list(c.id);
          return persons.map((ip) => ({
            id: ip.id,
            label: `${c.insurer_name} · ${ip.tariff_name ?? ip.kvnr ?? 'Tarif'}`,
            insuredPerson: ip,
          }));
        }),
      );
      insuredOptions = lists.flat();
    } catch (e) {
      loadError = e instanceof ApiError || e instanceof Error ? e.message : 'Laden fehlgeschlagen.';
    } finally {
      loading = false;
    }
  }

  onMount(load);

  const isEditable = $derived(invoice ? EDITABLE_STATUSES.has(invoice.status) : false);

  let saving = $state(false);
  let formError = $state<string | null>(null);

  async function handleSave(payload: FormPayload) {
    if (!invoice) return;
    formError = null;
    saving = true;
    try {
      await api.invoices.update(invoice.id, {
        insured_person_id: payload.insured_person_id,
        invoice_date: payload.invoice_date,
        invoice_number: payload.invoice_number,
        provider_name: payload.provider_name,
        provider_type: payload.provider_type ?? undefined,
        total_amount: payload.total_amount,
        eligible_amount: payload.eligible_amount,
        notes: payload.notes,
        positions: payload.positions,
      });
      await goto(resolve('/invoices/[id]', { id: invoice.id }));
    } catch (e) {
      formError =
        e instanceof ApiError || e instanceof Error
          ? e.message
          : 'Änderungen konnten nicht gespeichert werden.';
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>
    {invoice ? `${invoice.provider_name} bearbeiten` : 'Rechnung bearbeiten'} · selbstbehalt
  </title>
</svelte:head>

<div class="container mx-auto max-w-5xl px-4 py-8 space-y-6">
  <div>
    <a
      href={resolve('/invoices/[id]', { id: invoiceId })}
      class="text-sm text-muted-foreground hover:text-primary no-underline"
    >
      ← Zurück
    </a>
    <h1 class="text-2xl font-bold tracking-tight mt-1">
      {invoice ? `${invoice.provider_name} bearbeiten` : 'Rechnung bearbeiten'}
    </h1>
  </div>

  {#if loading}
    <LoadingState label="Rechnungsdaten werden geladen …" />
  {:else if loadError}
    <ErrorState title="Fehler" message={loadError} onRetry={load} />
  {:else if invoice && !isEditable}
    <Card>
      <CardContent class="pt-4 space-y-3">
        <p class="text-sm text-muted-foreground">
          Diese Rechnung hat den Status <strong class="text-foreground">{invoice.status}</strong> und
          kann nicht mehr bearbeitet werden.
        </p>
        <Button variant="outline" href={resolve('/invoices/[id]', { id: invoice.id })}>
          Zur Rechnung
        </Button>
      </CardContent>
    </Card>
  {:else if invoice}
    {@const invoiceId = invoice.id}
    <InvoiceForm
      mode="edit"
      initialData={invoice}
      {insuredOptions}
      {saving}
      {formError}
      onSave={handleSave}
    >
      {#snippet cancel()}
        <Button variant="outline" href={resolve('/invoices/[id]', { id: invoiceId })}
          >Abbrechen</Button
        >
      {/snippet}
    </InvoiceForm>
  {/if}
</div>
