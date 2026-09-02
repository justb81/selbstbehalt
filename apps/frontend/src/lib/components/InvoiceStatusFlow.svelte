<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  InvoiceStatusFlow (docs/architecture.md §5.2, issue #142; step-back issue #230):
  Presents the invoice lifecycle as three INDEPENDENT tracks — Prüfung, Bezahlung
  (an den Arzt) and Einreichung/Erstattung (beim Versicherer) — each with its own
  actions. Payment and submission run in parallel and both unlock once the invoice
  is geprüft.

  This component only orchestrates (issue #419): one track card per track
  (`InvoiceReviewTrack`, `InvoicePaymentTrack`, `InvoiceSubmissionTrack`), the
  refund-capture form (`InvoiceRefundForm`) and the audit trail
  (`InvoiceStatusHistory`). It owns the status-event reload every action triggers
  and the shared `busy` flag that disables the other tracks while one is running.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import type {
    InvoiceWithPositions,
    InvoiceStatusEvent,
    PaymentStatus,
    ReviewStatus,
  } from '@selbstbehalt/shared';
  import { isNonReimbursable } from '$lib/utils/reimbursability';
  import type { RefundFormMode } from '$lib/utils/refund-rows';
  import InvoiceReviewTrack from './InvoiceReviewTrack.svelte';
  import InvoicePaymentTrack from './InvoicePaymentTrack.svelte';
  import InvoiceSubmissionTrack from './InvoiceSubmissionTrack.svelte';
  import InvoiceRefundForm from './InvoiceRefundForm.svelte';
  import InvoiceStatusHistory from './InvoiceStatusHistory.svelte';
  import { Alert, AlertDescription } from '@selbstbehalt/ui/alert';
  import { Card, CardContent, CardHeader } from '@selbstbehalt/ui/card';

  let {
    invoice,
    onChanged,
  }: {
    invoice: InvoiceWithPositions;
    onChanged: () => void;
  } = $props();

  const status = $derived(invoice.status);
  const isGeprueft = $derived(status.review === 'geprüft');
  /**
   * The tariff reimburses nothing here, so submitting has no upside. The primary
   * action is replaced by an explanation, but not removed: the user may still submit
   * (to get the insurer's own verdict on record), and no backend guard changes.
   */
  const nothingToSubmit = $derived(isNonReimbursable(invoice));

  // ---- Status event history ------------------------------------------------

  let events = $state<InvoiceStatusEvent[]>([]);
  let eventsLoading = $state(false);
  let eventsError = $state<string | null>(null);

  async function loadEvents() {
    eventsLoading = true;
    eventsError = null;
    try {
      events = await api.invoices.events(invoice.id);
    } catch (e) {
      eventsError =
        e instanceof ApiError || e instanceof Error
          ? e.message
          : 'Statusverlauf konnte nicht geladen werden.';
    } finally {
      eventsLoading = false;
    }
  }

  onMount(loadEvents);

  /** Every lifecycle action reloads the trail and lets the page refetch the invoice. */
  async function afterAction() {
    await loadEvents();
    onChanged();
  }

  // ---- Review / payment track actions --------------------------------------

  let actioning = $state(false);
  let actionError = $state<string | null>(null);

  async function runReview(to: ReviewStatus) {
    actioning = true;
    actionError = null;
    try {
      await api.invoices.changeReview(invoice.id, { status: to });
      await afterAction();
    } catch (e) {
      actionError =
        e instanceof ApiError || e instanceof Error ? e.message : 'Statuswechsel fehlgeschlagen.';
    } finally {
      actioning = false;
    }
  }

  async function runPayment(to: PaymentStatus, paidOn?: string) {
    actioning = true;
    actionError = null;
    try {
      await api.invoices.changePayment(invoice.id, {
        status: to,
        ...(to === 'bezahlt' ? { paid_on: paidOn || null } : {}),
      });
      await afterAction();
    } catch (e) {
      actionError =
        e instanceof ApiError || e instanceof Error ? e.message : 'Statuswechsel fehlgeschlagen.';
    } finally {
      actioning = false;
    }
  }

  // ---- Submission track ----------------------------------------------------

  let reverting = $state(false);

  function goToSubmit() {
    void goto(resolve('/invoices/[id]/submit', { id: invoice.id }));
  }

  // ---- Refund capture (eingereicht → erstattet, or its "Bearbeiten") -------

  let refundMode = $state<RefundFormMode | null>(null);
  let refunding = $state(false);

  /** Note of the stored refund, pre-filled when correcting an existing one. */
  const storedRefundNote = $derived(events.find((e) => e.status === 'erstattet')?.note ?? '');

  const busy = $derived(actioning || refunding || reverting);
</script>

<Card>
  <CardHeader class="pb-3">
    <p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Workflow</p>
  </CardHeader>
  <CardContent class="space-y-4">
    <InvoiceReviewTrack {status} {busy} onChange={runReview} />

    <InvoicePaymentTrack
      {status}
      {isGeprueft}
      {busy}
      onChange={runPayment}
      onOpenForm={() => (actionError = null)}
    />

    <InvoiceSubmissionTrack
      invoiceId={invoice.id}
      {status}
      {isGeprueft}
      {nothingToSubmit}
      {busy}
      bind:reverting
      onSubmitStep={goToSubmit}
      onCaptureRefund={(mode) => (refundMode = mode)}
      onReverted={afterAction}
    />

    {#if actionError}
      <Alert variant="destructive">
        <AlertDescription>{actionError}</AlertDescription>
      </Alert>
    {/if}

    {#if refundMode}
      <InvoiceRefundForm
        {invoice}
        mode={refundMode}
        initialNote={refundMode === 'edit' ? storedRefundNote : ''}
        bind:pending={refunding}
        onSaved={async () => {
          refundMode = null;
          await afterAction();
        }}
        onCancel={() => (refundMode = null)}
      />
    {/if}

    <InvoiceStatusHistory {events} loading={eventsLoading} error={eventsError} />
  </CardContent>
</Card>
