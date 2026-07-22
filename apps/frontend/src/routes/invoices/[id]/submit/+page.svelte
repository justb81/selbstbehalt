<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Einreichungsformular (docs/design.md §6.1, issue #22): records the submission
  of an invoice to the insurer. Only metadata is captured here — the actual
  refund amounts are tracked per position via PUT /api/invoices/:id/refund
  (Issue #139).

  Doubles as the "Bearbeiten" form for the eingereicht step (issue #230): if
  the invoice is already eingereicht, the existing submission is loaded and
  corrections are saved via PUT /api/invoices/:id/submission in place, instead
  of creating a new submission and transitioning the status.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import {
    formatDate,
    submissionChannelValues,
    type InvoiceWithPositions,
    type SubmissionChannel,
  } from '@selbstbehalt/shared';
  import { setBreadcrumbEntity } from '$lib/stores/breadcrumb';
  import LoadingState from '$lib/components/LoadingState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Card, CardContent } from '$lib/components/ui/card';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';

  const CHANNEL_LABELS: Record<SubmissionChannel, string> = {
    app: 'App',
    post: 'Post',
    email: 'E-Mail',
  };

  const invoiceId = $derived(page.params.id as string);

  let invoice = $state<InvoiceWithPositions | null>(null);
  let loading = $state(true);
  let loadError = $state<string | null>(null);

  const mode = $derived(
    invoice?.status.submission === 'eingereicht'
      ? 'edit'
      : invoice?.status.review === 'geprüft' && invoice?.status.submission === 'nicht_eingereicht'
        ? 'create'
        : null,
  );

  // ---- Form state ----
  const nowIso = new Date().toISOString().slice(0, 16); // datetime-local format
  let submittedAt = $state(nowIso);
  let submittedVia = $state<SubmissionChannel>('app');
  let expectedRefund = $state<number | null>(null);

  async function loadInvoice() {
    loading = true;
    loadError = null;
    try {
      invoice = await api.invoices.get(invoiceId);
      // Neue Einreichung: das Feld mit dem berechneten Erstattungsbetrag der Rechnung
      // vorbelegen (Σ positions.eligible_amount, serverseitig aggregiert). Bleibt
      // editierbar. Im Bearbeiten-Modus zählt danach der gespeicherte Wert.
      expectedRefund = invoice.eligible_amount ?? null;
      if (invoice.status.submission === 'eingereicht') {
        const submission = await api.invoices.getSubmission(invoiceId);
        submittedAt = submission.submitted_at ? submission.submitted_at.slice(0, 16) : nowIso;
        submittedVia = submission.submitted_via ?? 'app';
        expectedRefund = submission.expected_refund ?? null;
      }
    } catch (e) {
      loadError = e instanceof ApiError || e instanceof Error ? e.message : 'Laden fehlgeschlagen.';
    } finally {
      loading = false;
    }
  }

  onMount(loadInvoice);

  // The object crumb (link to the invoice) shows the real provider name.
  $effect(() => {
    if (invoice) setBreadcrumbEntity(invoiceId, invoice.provider_name);
  });

  let saving = $state(false);
  let formError = $state<string | null>(null);

  async function submit() {
    if (!invoice || !mode) return;
    saving = true;
    formError = null;
    try {
      const payload = {
        submitted_at: submittedAt ? `${submittedAt}:00Z` : null,
        submitted_via: submittedVia,
        expected_refund: expectedRefund,
      };
      if (mode === 'edit') {
        await api.invoices.updateSubmission(invoice.id, payload);
      } else {
        await api.invoices.submit(invoice.id, payload);
      }
      await goto(resolve('/invoices/[id]', { id: invoice.id }));
    } catch (e) {
      formError =
        e instanceof ApiError || e instanceof Error
          ? e.message
          : 'Einreichung konnte nicht gespeichert werden.';
      saving = false;
    }
  }

  const selectClass =
    'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
</script>

<svelte:head
  ><title>{mode === 'edit' ? 'Einreichung bearbeiten' : 'Einreichung'} · selbstbehalt</title
  ></svelte:head
>

<div class="container mx-auto max-w-5xl px-4 py-8 space-y-6">
  <h1 class="text-2xl font-bold tracking-tight">
    {mode === 'edit' ? 'Einreichung bearbeiten' : 'Einreichung'}
  </h1>

  {#if loading}
    <LoadingState label="Rechnungsdaten werden geladen …" />
  {:else if loadError}
    <ErrorState title="Fehler" message={loadError} onRetry={loadInvoice} />
  {:else if invoice && !mode}
    <Card>
      <CardContent class="pt-4 space-y-3">
        <p class="text-sm text-muted-foreground">
          Diese Rechnung kann derzeit nicht (mehr) eingereicht werden — sie ist entweder noch nicht
          geprüft oder bereits erstattet.
        </p>
        <Button variant="outline" href={resolve('/invoices/[id]', { id: invoice.id })}>
          Zur Rechnung
        </Button>
      </CardContent>
    </Card>
  {:else if invoice}
    <p class="text-sm text-muted-foreground">
      Rechnung <strong class="text-foreground">{invoice.provider_name}</strong> vom {formatDate(
        invoice.invoice_date,
      )}
    </p>

    <form
      onsubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Card>
        <CardContent class="pt-6 space-y-6">
          <div class="space-y-4">
            <p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Einreichung
            </p>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div class="space-y-1">
                <Label>Eingereicht am</Label>
                <Input type="datetime-local" bind:value={submittedAt} />
              </div>

              <div class="space-y-1">
                <Label>Einreichungsweg</Label>
                <select bind:value={submittedVia} class={selectClass}>
                  {#each submissionChannelValues as ch (ch)}
                    <option value={ch}>{CHANNEL_LABELS[ch]}</option>
                  {/each}
                </select>
              </div>

              <div class="space-y-1">
                <Label>Erwartete Erstattung (€)</Label>
                <Input
                  type="number"
                  value={expectedRefund ?? ''}
                  oninput={(e) => {
                    const v = (e.target as HTMLInputElement).value;
                    expectedRefund = v ? parseFloat(v) : null;
                  }}
                  min="0"
                  step="0.01"
                  placeholder="optional"
                />
              </div>
            </div>
          </div>

          {#if formError}
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          {/if}

          <div class="flex flex-wrap gap-2 items-center">
            <Button type="submit" disabled={saving}>
              {saving
                ? 'Wird gespeichert …'
                : mode === 'edit'
                  ? 'Änderungen speichern'
                  : 'Einreichung speichern'}
            </Button>
            <Button variant="outline" href={resolve('/invoices/[id]', { id: invoiceId })}
              >Abbrechen</Button
            >
          </div>
        </CardContent>
      </Card>
    </form>
  {/if}
</div>
