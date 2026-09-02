<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Rechnungsbearbeitung (issue #119): edit a saved invoice's header fields and
  positions, and re-validate positions against the Gebührenordnung. Editing is
  locked once money has moved — i.e. as soon as the invoice is paid
  (`payment = bezahlt`) or submitted (`submission ≠ nicht_eingereicht`). Those
  steps can still be undone or corrected via the track controls on the invoice
  detail page (issue #230).
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import {
    loadInsuredOptions,
    loadInvoiceHistory,
    type InsuredOption,
  } from '$lib/api/invoice-form-data';
  import type { InvoiceWithPositions } from '@selbstbehalt/shared';
  import { setBreadcrumbEntity } from '$lib/stores/breadcrumb';
  import InvoiceForm from '$lib/components/InvoiceForm.svelte';
  import type { FormPayload } from '$lib/components/InvoiceForm.svelte';
  import LoadingState from '$lib/components/LoadingState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import { Button } from '@selbstbehalt/ui/button';
  import { Card, CardContent } from '@selbstbehalt/ui/card';

  const invoiceId = $derived(page.params.id as string);

  let invoice = $state<InvoiceWithPositions | null>(null);
  let insuredOptions = $state<InsuredOption[]>([]);
  let loading = $state(true);
  let loadError = $state<string | null>(null);

  async function load() {
    loading = true;
    loadError = null;
    try {
      const [inv, options] = await Promise.all([api.invoices.get(invoiceId), loadInsuredOptions()]);
      invoice = inv;
      insuredOptions = options;
    } catch (e) {
      loadError = e instanceof ApiError || e instanceof Error ? e.message : 'Laden fehlgeschlagen.';
    } finally {
      loading = false;
    }
  }

  onMount(load);

  // The object crumb (link to the invoice) shows the real provider name.
  $effect(() => {
    if (invoice) setBreadcrumbEntity(invoiceId, invoice.provider_name);
  });

  // Editing is locked once money has moved: paid or already submitted.
  const isEditable = $derived(
    invoice
      ? invoice.status.payment === 'offen' && invoice.status.submission === 'nicht_eingereicht'
      : false,
  );

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
        payment_due_date: payload.payment_due_date,
        invoice_number: payload.invoice_number,
        provider_name: payload.provider_name,
        provider_type: payload.provider_type ?? undefined,
        total_amount: payload.total_amount,
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
  <h1 class="text-2xl font-bold tracking-tight">
    {invoice ? `${invoice.provider_name} bearbeiten` : 'Rechnung bearbeiten'}
  </h1>

  {#if loading}
    <LoadingState label="Rechnungsdaten werden geladen …" />
  {:else if loadError}
    <ErrorState title="Fehler" message={loadError} onRetry={load} />
  {:else if invoice && !isEditable}
    <Card>
      <CardContent class="pt-4 space-y-3">
        <p class="text-sm text-muted-foreground">
          Diese Rechnung ist bereits bezahlt oder eingereicht und kann nicht mehr bearbeitet werden.
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
      invoiceHistory={loadInvoiceHistory}
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
