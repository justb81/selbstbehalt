<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Rechnungserfassung (docs/design.md §6.1, issues #22/#26/#109): thin wrapper
  around InvoiceForm. OCR scanning and form state live in the shared component.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import type { InsuredPerson } from '@selbstbehalt/shared';
  import InvoiceForm from '$lib/components/InvoiceForm.svelte';
  import type { FormPayload } from '$lib/components/InvoiceForm.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';

  type InsuredOption = { id: string; label: string; insuredPerson: InsuredPerson };

  let insuredOptions = $state<InsuredOption[]>([]);
  let loadingPersons = $state(true);
  let loadError = $state<string | null>(null);

  async function loadPersons() {
    loadingPersons = true;
    loadError = null;
    try {
      const contracts = await api.contracts.list();
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
    } catch {
      loadError = 'Versicherte Personen konnten nicht geladen werden.';
    } finally {
      loadingPersons = false;
    }
  }

  onMount(loadPersons);

  let saving = $state(false);
  let formError = $state<string | null>(null);

  async function handleSave(payload: FormPayload) {
    formError = null;
    saving = true;
    try {
      const invoice = await api.invoices.create({
        insured_person_id: payload.insured_person_id,
        invoice_date: payload.invoice_date,
        invoice_number: payload.invoice_number,
        provider_name: payload.provider_name,
        provider_type: payload.provider_type ?? undefined,
        total_amount: payload.total_amount,
        eligible_amount: payload.eligible_amount,
        notes: payload.notes,
        ocr_raw: payload.ocr_raw,
        positions: payload.positions.length > 0 ? payload.positions : undefined,
      });
      await goto(resolve('/invoices/[id]', { id: invoice.id }));
    } catch (e) {
      formError =
        e instanceof ApiError || e instanceof Error
          ? e.message
          : 'Rechnung konnte nicht gespeichert werden.';
      saving = false;
    }
  }
</script>

<svelte:head><title>Rechnung erfassen · selbstbehalt</title></svelte:head>

<div class="container mx-auto max-w-5xl px-4 py-8 space-y-6">
  <h1 class="text-2xl font-bold tracking-tight">Rechnung erfassen</h1>

  {#if loadingPersons}
    <p class="text-sm text-muted-foreground">Daten werden geladen …</p>
  {:else if loadError}
    <Alert variant="destructive">
      <AlertDescription>{loadError}</AlertDescription>
    </Alert>
  {:else if insuredOptions.length === 0}
    <div class="flex flex-col items-center justify-center py-16 text-center">
      <p class="text-muted-foreground">Noch keine versicherten Personen vorhanden.</p>
      <Button class="mt-4" href={resolve('/contracts/new')}>Vertrag anlegen</Button>
    </div>
  {:else}
    <InvoiceForm mode="create" {insuredOptions} {saving} {formError} onSave={handleSave}>
      {#snippet cancel()}
        <Button variant="outline" href={resolve('/invoices')}>Abbrechen</Button>
      {/snippet}
    </InvoiceForm>
  {/if}
</div>
