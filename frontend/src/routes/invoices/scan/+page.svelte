<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Scan flow (docs/design.md §4.1, issue #26): wires capture → OCR → parse →
  review → save into one screen. Foto/Datei is recognised on-device by
  `OCRScanner`, corrected in `InvoiceReview`, then saved as metadata only via
  `POST /api/invoices`. On success it jumps to the invoice detail, where the
  Günstigerprüfung (GCPCard, #22/#18) lives.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';

  import { api, ApiError } from '$lib/api';
  import { disposeScanOcr, type InsuredOption, type ScanResult } from '$lib/ocr';
  import OCRScanner from '$lib/components/OCRScanner.svelte';
  import InvoiceReview from '$lib/components/InvoiceReview.svelte';
  import LoadingState from '$lib/components/LoadingState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import type { InvoiceCreatePayload } from '@selbstbehalt/shared';

  const title = 'Rechnung scannen';

  let insuredPersons = $state<InsuredOption[]>([]);
  let loadingPersons = $state(true);
  let loadError = $state<string | null>(null);

  let scan = $state<ScanResult | null>(null);
  let saving = $state(false);
  let saveError = $state<string | null>(null);

  /** Loads every insured person across all contracts for the filing dropdown. */
  async function loadInsuredPersons(): Promise<void> {
    loadingPersons = true;
    loadError = null;
    try {
      const contracts = await api.contracts.list();
      const lists = await Promise.all(
        contracts.map(async (contract) => {
          const insured = await api.insured.list(contract.id);
          return insured.map((person) => ({
            id: person.id,
            label: `${contract.insurer_name} · ${person.tariff_name ?? person.kvnr ?? 'Tarif'}`,
          }));
        }),
      );
      insuredPersons = lists.flat();
    } catch {
      loadError = 'Versicherte Personen konnten nicht geladen werden.';
    } finally {
      loadingPersons = false;
    }
  }

  onMount(loadInsuredPersons);
  onDestroy(disposeScanOcr);

  function onScanned(result: ScanResult): void {
    scan = result;
    saveError = null;
  }

  function retake(): void {
    scan = null;
    saveError = null;
    // Recover from an earlier load failure on the way back to the scanner.
    if (loadError) void loadInsuredPersons();
  }

  async function save(payload: InvoiceCreatePayload): Promise<void> {
    saving = true;
    saveError = null;
    try {
      const invoice = await api.invoices.create(payload);
      // Straight into the Günstigerprüfung for the freshly saved invoice (#26).
      await goto(resolve('/invoices/[id]', { id: invoice.id }));
    } catch (err) {
      // Surface the real reason (e.g. a backend 400 validation detail) instead
      // of swallowing it behind a fixed string.
      const detail = err instanceof ApiError || err instanceof Error ? err.message : null;
      saveError = detail
        ? `Die Rechnung konnte nicht gespeichert werden: ${detail}`
        : 'Die Rechnung konnte nicht gespeichert werden.';
      saving = false;
    }
  }
</script>

<svelte:head><title>{title} · selbstbehalt</title></svelte:head>

<section>
  <h1>{title}</h1>

  {#if !scan}
    <p>
      Rechnung fotografieren oder als Bild/PDF wählen. Erkennung und Prüfung laufen vollständig auf
      diesem Gerät; das Bild verlässt es nie.
    </p>
    <OCRScanner {onScanned} />
  {:else if loadingPersons}
    <LoadingState label="Versicherte Personen werden geladen …" />
  {:else if loadError}
    <ErrorState
      title="Versicherte Personen nicht geladen"
      message={loadError}
      onRetry={loadInsuredPersons}
    />
    <button type="button" class="link" onclick={retake}>Neu scannen</button>
  {:else if insuredPersons.length === 0}
    <p class="error" role="alert">
      Es ist noch keine versicherte Person angelegt. Bitte zuerst einen Vertrag mit versicherter
      Person erfassen.
    </p>
    <button type="button" class="link" onclick={retake}>Neu scannen</button>
  {:else}
    <InvoiceReview {scan} {insuredPersons} {saving} onSubmit={save} onRetake={retake} />

    {#if saveError}
      <p class="error" role="alert">{saveError}</p>
    {/if}
  {/if}
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .error {
    margin: 0;
    color: var(--color-danger);
    font-size: var(--font-size-sm);
  }

  .link {
    align-self: flex-start;
    padding: 0;
    border: none;
    background: none;
    color: var(--color-primary-strong);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
</style>
