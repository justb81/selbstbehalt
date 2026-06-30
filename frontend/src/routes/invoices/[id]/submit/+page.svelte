<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Einreichungsformular (docs/design.md §6.1, issue #22): records the submission
  of an invoice to the insurer and optionally the actual refund received.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import {
    submissionChannelValues,
    type InvoiceWithPositions,
    type SubmissionChannel,
  } from '@selbstbehalt/shared';
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

  async function loadInvoice() {
    loading = true;
    loadError = null;
    try {
      invoice = await api.invoices.get(invoiceId);
    } catch (e) {
      loadError = e instanceof ApiError || e instanceof Error ? e.message : 'Laden fehlgeschlagen.';
    } finally {
      loading = false;
    }
  }

  onMount(loadInvoice);

  // ---- Form state ----
  const nowIso = new Date().toISOString().slice(0, 16); // datetime-local format
  let submittedAt = $state(nowIso);
  let submittedVia = $state<SubmissionChannel>('app');
  let expectedRefund = $state<number | null>(null);
  let actualRefund = $state<number | null>(null);
  let refundDate = $state('');
  let rejectionReason = $state('');
  let isRejected = $state(false);

  let saving = $state(false);
  let formError = $state<string | null>(null);

  async function submit() {
    if (!invoice) return;
    saving = true;
    formError = null;
    try {
      await api.invoices.submit(invoice.id, {
        submitted_at: submittedAt ? `${submittedAt}:00Z` : null,
        submitted_via: submittedVia,
        expected_refund: expectedRefund,
        actual_refund: actualRefund,
        refund_date: refundDate.trim() || null,
        rejection_reason: isRejected ? rejectionReason.trim() || null : null,
      });
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

<svelte:head><title>Einreichung · selbstbehalt</title></svelte:head>

<div class="container mx-auto max-w-5xl px-4 py-8 space-y-6">
  <h1 class="text-2xl font-bold tracking-tight">Einreichung</h1>

  {#if loading}
    <LoadingState label="Rechnungsdaten werden geladen …" />
  {:else if loadError}
    <ErrorState title="Fehler" message={loadError} onRetry={loadInvoice} />
  {:else if invoice}
    <p class="text-sm text-muted-foreground">
      Rechnung <strong class="text-foreground">{invoice.provider_name}</strong> vom {invoice.invoice_date}
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

          <div class="space-y-4">
            <div>
              <p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Erstattung
              </p>
              <p class="text-sm text-muted-foreground mt-1">
                Nach Eingang des Erstattungsbescheids hier eintragen. Kann auch später ergänzt
                werden.
              </p>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div class="space-y-1">
                <Label>Tatsächliche Erstattung (€)</Label>
                <Input
                  type="number"
                  value={actualRefund ?? ''}
                  oninput={(e) => {
                    const v = (e.target as HTMLInputElement).value;
                    actualRefund = v ? parseFloat(v) : null;
                  }}
                  min="0"
                  step="0.01"
                  placeholder="optional"
                />
              </div>

              <div class="space-y-1">
                <Label>Erstattungsdatum</Label>
                <Input type="date" bind:value={refundDate} />
              </div>
            </div>
          </div>

          <label class="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" bind:checked={isRejected} class="rounded" />
            <span>Rechnung wurde abgelehnt</span>
          </label>

          {#if isRejected}
            <div class="space-y-1">
              <Label>Ablehnungsgrund</Label>
              <textarea
                bind:value={rejectionReason}
                rows="3"
                placeholder="optional"
                class="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
              ></textarea>
            </div>
          {/if}

          {#if formError}
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          {/if}

          <div class="flex flex-wrap gap-2 items-center">
            <Button type="submit" disabled={saving}>
              {saving ? 'Wird gespeichert …' : 'Einreichung speichern'}
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
