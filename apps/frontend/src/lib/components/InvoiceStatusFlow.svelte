<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  InvoiceStatusFlow (docs/design.md §6.2, issue #142; step-back issue #230):
  Presents the invoice lifecycle as three INDEPENDENT tracks — Prüfung, Bezahlung
  (an den Arzt) and Einreichung/Erstattung (beim Versicherer) — each with its own
  actions. Payment and submission run in parallel and both unlock once the invoice
  is geprüft. Includes the per-Leistungsbereich/per-position refund-entry form, the
  submission-scoped undo/edit controls, and the full status-event audit trail.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import {
    BENEFIT_CATEGORY_LABELS,
    formatDate,
    formatEur,
    roundCents,
    type BenefitCategory,
    type InvoiceWithPositions,
    type InvoiceStatusEvent,
    type PaymentStatus,
    type ReviewStatus,
    type StatusTrack,
  } from '@selbstbehalt/shared';
  import { benefitCategoryForPosition } from '$lib/utils/benefit-category';
  import { distributeRefundByCategory } from '$lib/utils/refund-distribution';
  import InvoiceBadge from './InvoiceBadge.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Tabs, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';
  import { Card, CardContent, CardHeader } from '$lib/components/ui/card';
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
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from '$lib/components/ui/table';

  let {
    invoice,
    onChanged,
  }: {
    invoice: InvoiceWithPositions;
    onChanged: () => void;
  } = $props();

  const status = $derived(invoice.status);
  const isGeprueft = $derived(status.review === 'geprüft');

  // ---- Status event history ------------------------------------------------

  let events = $state<InvoiceStatusEvent[]>([]);
  let eventsLoading = $state(false);
  let eventsError = $state<string | null>(null);

  const TRACK_LABELS: Record<StatusTrack, string> = {
    review: 'Prüfung',
    payment: 'Zahlung',
    submission: 'Einreichung',
  };

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

  // ---- Review / payment track actions --------------------------------------

  let actioning = $state(false);
  let actionError = $state<string | null>(null);

  async function runReview(to: ReviewStatus) {
    actioning = true;
    actionError = null;
    try {
      await api.invoices.changeReview(invoice.id, { status: to });
      await loadEvents();
      onChanged();
    } catch (e) {
      actionError =
        e instanceof ApiError || e instanceof Error ? e.message : 'Statuswechsel fehlgeschlagen.';
    } finally {
      actioning = false;
    }
  }

  let showPayForm = $state(false);
  let payDate = $state('');

  function openPayForm() {
    payDate = new Date().toISOString().slice(0, 10);
    actionError = null;
    showPayForm = true;
  }

  async function runPayment(to: PaymentStatus, paidOn?: string) {
    actioning = true;
    actionError = null;
    try {
      await api.invoices.changePayment(invoice.id, {
        status: to,
        ...(to === 'bezahlt' ? { paid_on: paidOn || null } : {}),
      });
      showPayForm = false;
      await loadEvents();
      onChanged();
    } catch (e) {
      actionError =
        e instanceof ApiError || e instanceof Error ? e.message : 'Statuswechsel fehlgeschlagen.';
    } finally {
      actioning = false;
    }
  }

  // ---- Submission track: step back / edit (issue #230) ---------------------

  const REVERT_WARNING: Record<'eingereicht' | 'erstattet', string> = {
    eingereicht:
      'Die erfasste Einreichung wird gelöscht; der Status wird auf „Nicht eingereicht" zurückgesetzt.',
    erstattet:
      'Die erfassten Erstattungsbeträge werden gelöscht; der Status wird auf „Eingereicht" zurückgesetzt.',
  };

  let confirmRevert = $state(false);
  let reverting = $state(false);
  let revertError = $state<string | null>(null);

  async function revertSubmission() {
    reverting = true;
    revertError = null;
    try {
      await api.invoices.revertSubmission(invoice.id, {});
      confirmRevert = false;
      await loadEvents();
      onChanged();
    } catch (e) {
      revertError =
        e instanceof ApiError || e instanceof Error
          ? e.message
          : 'Rückgängig machen fehlgeschlagen.';
    } finally {
      reverting = false;
    }
  }

  function goToSubmit() {
    void goto(resolve('/invoices/[id]/submit', { id: invoice.id }));
  }

  // ---- Refund capture (eingereicht → erstattet, or its "Bearbeiten") -------

  // Two entry modes for the same per-position refund store: the insurer's
  // Leistungsabrechnung usually reports one amount per Leistungsbereich, so
  // "je Kategorie" (default) captures a single amount per category and distributes
  // it across that category's positions; "je Position" keeps the granular per-line
  // entry for itemised statements.
  type RefundEntryMode = 'category' | 'position';

  type RefundRow = {
    id: string;
    goae_number: string;
    description: string | null;
    charged_amount: number;
    eligible_amount: number | null;
    refund_amount: number;
  };

  type CategoryRefundRow = {
    category: BenefitCategory;
    label: string;
    charged_amount: number;
    eligible_amount: number | null;
    refund_amount: number;
  };

  let showRefundForm = $state(false);
  let refundFormMode = $state<'create' | 'edit'>('create');
  let refundEntryMode = $state<RefundEntryMode>('category');
  let refundRows = $state<RefundRow[]>([]);
  let categoryRows = $state<CategoryRefundRow[]>([]);
  let refundDate = $state('');
  let refundNote = $state('');
  let refunding = $state(false);
  let refundError = $state<string | null>(null);

  /** Default refund for one position: the stored amount when editing, else the estimate. */
  function defaultPositionRefund(
    p: InvoiceWithPositions['positions'][number],
    mode: 'create' | 'edit',
  ): number {
    return mode === 'edit'
      ? (p.refund_amount ?? p.eligible_amount ?? p.charged_amount)
      : (p.eligible_amount ?? p.charged_amount);
  }

  /** Groups the invoice's positions by benefit category into the per-category rows. */
  function buildCategoryRows(mode: 'create' | 'edit'): CategoryRefundRow[] {
    type Acc = { charged: number; eligible: number; hasEligible: boolean; refund: number };
    const order: BenefitCategory[] = [];
    // Plain object accumulator (not a Map) — SvelteMap would be reactive overkill for
    // this transient grouping, and a mutated built-in Map trips svelte/prefer-svelte-reactivity.
    const acc: Partial<Record<BenefitCategory, Acc>> = {};
    for (const p of invoice.positions) {
      const category = benefitCategoryForPosition(p, invoice.provider_type);
      let entry = acc[category];
      if (!entry) {
        entry = { charged: 0, eligible: 0, hasEligible: false, refund: 0 };
        acc[category] = entry;
        order.push(category);
      }
      entry.charged += p.charged_amount;
      if (p.eligible_amount != null) {
        entry.eligible += p.eligible_amount;
        entry.hasEligible = true;
      }
      entry.refund += defaultPositionRefund(p, mode);
    }
    return order.map((category) => {
      const entry = acc[category]!;
      return {
        category,
        label: BENEFIT_CATEGORY_LABELS[category],
        charged_amount: roundCents(entry.charged),
        eligible_amount: entry.hasEligible ? roundCents(entry.eligible) : null,
        refund_amount: roundCents(entry.refund),
      };
    });
  }

  async function openRefundForm(mode: 'create' | 'edit') {
    refundFormMode = mode;
    refundRows = invoice.positions.map((p) => ({
      id: p.id,
      goae_number: p.goae_number,
      description: p.description ?? null,
      charged_amount: p.charged_amount,
      eligible_amount: p.eligible_amount ?? null,
      refund_amount: defaultPositionRefund(p, mode),
    }));
    categoryRows = buildCategoryRows(mode);
    refundDate = new Date().toISOString().slice(0, 10);
    refundNote = mode === 'edit' ? (events.find((e) => e.status === 'erstattet')?.note ?? '') : '';
    refundError = null;
    showRefundForm = true;

    if (mode === 'edit') {
      try {
        const submission = await api.invoices.getSubmission(invoice.id);
        if (submission.refund_date) refundDate = submission.refund_date;
      } catch {
        // No submission (shouldn't happen once erstattet) — keep today's date.
      }
    }
  }

  /** The per-position refund payload for the current entry mode. */
  function refundPositionsPayload(): { id: string; refund_amount: number }[] {
    if (refundEntryMode === 'position') {
      return refundRows.map((r) => ({ id: r.id, refund_amount: r.refund_amount }));
    }
    const amountByCategory = new Map<BenefitCategory, number>(
      categoryRows.map((r) => [r.category, Number(r.refund_amount) || 0]),
    );
    const distributed = distributeRefundByCategory(
      invoice.positions.map((p) => ({
        id: p.id,
        category: benefitCategoryForPosition(p, invoice.provider_type),
        eligible_amount: p.eligible_amount,
        charged_amount: p.charged_amount,
      })),
      amountByCategory,
    );
    return invoice.positions.map((p) => ({ id: p.id, refund_amount: distributed.get(p.id) ?? 0 }));
  }

  async function submitRefund() {
    refunding = true;
    refundError = null;
    try {
      await api.invoices.refund(invoice.id, {
        positions: refundPositionsPayload(),
        refund_date: refundDate || null,
        note: refundNote.trim() || null,
      });
      showRefundForm = false;
      await loadEvents();
      onChanged();
    } catch (e) {
      refundError =
        e instanceof ApiError || e instanceof Error
          ? e.message
          : 'Erstattung konnte nicht gespeichert werden.';
    } finally {
      refunding = false;
    }
  }

  // ---- Helpers --------------------------------------------------------------

  function formatTimestamp(iso: string): string {
    const d = formatDate(iso);
    const t = iso.slice(11, 16);
    return t ? `${d} ${t}` : d;
  }

  const busy = $derived(actioning || refunding || reverting);
</script>

<Card>
  <CardHeader class="pb-3">
    <p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Workflow</p>
  </CardHeader>
  <CardContent class="space-y-4">
    <!-- Track 1: Prüfung ---------------------------------------------------- -->
    <div class="rounded-md border border-border p-3 space-y-2">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-sm font-medium">Prüfung</span>
        <InvoiceBadge status={status.review} />
      </div>
      <div class="flex flex-wrap gap-2">
        {#if status.review === 'neu'}
          <Button size="sm" onclick={() => runReview('geprüft')} disabled={busy}>
            Als geprüft markieren
          </Button>
        {:else}
          <Button
            variant="outline"
            size="sm"
            onclick={() => runReview('neu')}
            disabled={busy ||
              status.payment !== 'offen' ||
              status.submission !== 'nicht_eingereicht'}
          >
            Prüfung zurücknehmen
          </Button>
        {/if}
      </div>
    </div>

    <!-- Track 2: Bezahlung an den Arzt -------------------------------------- -->
    <div class="rounded-md border border-border p-3 space-y-2">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-sm font-medium">Bezahlung an den Arzt</span>
        <InvoiceBadge status={status.payment} />
        {#if status.paid_on}
          <span class="text-xs text-muted-foreground">am {formatDate(status.paid_on)}</span>
        {/if}
      </div>
      {#if !isGeprueft}
        <p class="text-xs text-muted-foreground">Erst nach der Prüfung möglich.</p>
      {:else if status.payment === 'offen'}
        {#if showPayForm}
          <div class="flex flex-wrap items-end gap-2">
            <div class="space-y-1.5">
              <Label for="pay-date">Zahlungsdatum</Label>
              <Input id="pay-date" type="date" bind:value={payDate} class="w-44" />
            </div>
            <Button size="sm" onclick={() => runPayment('bezahlt', payDate)} disabled={busy}>
              Speichern
            </Button>
            <Button
              variant="outline"
              size="sm"
              onclick={() => (showPayForm = false)}
              disabled={busy}
            >
              Abbrechen
            </Button>
          </div>
        {:else}
          <Button size="sm" onclick={openPayForm} disabled={busy}>Als bezahlt markieren</Button>
        {/if}
      {:else}
        <Button variant="outline" size="sm" onclick={() => runPayment('offen')} disabled={busy}>
          Zahlung zurücknehmen
        </Button>
      {/if}
    </div>

    <!-- Track 3: Einreichung / Erstattung ----------------------------------- -->
    <div class="rounded-md border border-border p-3 space-y-2">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-sm font-medium">Einreichung / Erstattung</span>
        <InvoiceBadge status={status.submission} />
      </div>
      {#if !isGeprueft}
        <p class="text-xs text-muted-foreground">Erst nach der Prüfung möglich.</p>
      {:else if status.submission === 'nicht_eingereicht'}
        <Button size="sm" onclick={goToSubmit} disabled={busy}>Einreichen …</Button>
      {:else if status.submission === 'eingereicht'}
        <div class="flex flex-wrap gap-2">
          <Button size="sm" onclick={() => openRefundForm('create')} disabled={busy}>
            Erstattung erfassen
          </Button>
          <Button variant="outline" size="sm" onclick={goToSubmit} disabled={busy}>
            Einreichung bearbeiten
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="border-destructive text-destructive hover:bg-destructive/10"
            onclick={() => (confirmRevert = true)}
            disabled={busy}
          >
            Einreichung löschen
          </Button>
        </div>
      {:else}
        <div class="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onclick={() => openRefundForm('edit')}
            disabled={busy}
          >
            Erstattung bearbeiten
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="border-destructive text-destructive hover:bg-destructive/10"
            onclick={() => (confirmRevert = true)}
            disabled={busy}
          >
            Erstattung löschen
          </Button>
        </div>
      {/if}
    </div>

    {#if actionError}
      <Alert variant="destructive">
        <AlertDescription>{actionError}</AlertDescription>
      </Alert>
    {/if}

    <!-- Submission revert confirmation -->
    <AlertDialogRoot
      bind:open={confirmRevert}
      onOpenChange={(open) => {
        if (!open) revertError = null;
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Schritt löschen?</AlertDialogTitle>
          <AlertDialogDescription>
            {status.submission === 'erstattet'
              ? REVERT_WARNING.erstattet
              : REVERT_WARNING.eingereicht}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {#if revertError}
          <Alert variant="destructive">
            <AlertDescription>{revertError}</AlertDescription>
          </Alert>
        {/if}
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onclick={revertSubmission} disabled={reverting}>
            {reverting ? 'Wird gelöscht …' : 'Ja, löschen'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialogRoot>

    <!-- Refund capture form (eingereicht → erstattet, or its "Bearbeiten") -->
    {#if showRefundForm}
      <div class="rounded-md border border-border bg-muted/20 p-4 space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="text-sm font-medium">
            {refundFormMode === 'edit'
              ? 'Erstattungsbeträge korrigieren'
              : 'Erstattungsbeträge erfassen'}
          </p>
          <Tabs bind:value={refundEntryMode}>
            <TabsList>
              <TabsTrigger value="category">Je Kategorie</TabsTrigger>
              <TabsTrigger value="position">Je Position</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <p class="text-xs text-muted-foreground">
          {refundEntryMode === 'category'
            ? 'Betrag je Kategorie laut Leistungsabrechnung; wird auf die Positionen verteilt. 0 = abgelehnt.'
            : 'Betrag je Position. 0 = abgelehnt. Vorbefüllt mit dem erstattungsfähigen Betrag.'}
        </p>

        {#if invoice.positions.length === 0}
          <p class="text-sm text-muted-foreground">Keine Positionen vorhanden.</p>
        {:else if refundEntryMode === 'category'}
          <div class="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kategorie</TableHead>
                  <TableHead class="text-right">Betrag (€)</TableHead>
                  <TableHead class="w-32 text-right">Erstattet (€)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {#each categoryRows as row (row.category)}
                  <TableRow>
                    <TableCell class="text-sm">{row.label}</TableCell>
                    <TableCell class="text-right tabular-nums text-sm align-top">
                      {formatEur(row.charged_amount)}
                      {#if row.eligible_amount != null}
                        <br /><span class="text-xs text-muted-foreground">
                          erstattungsfähig: {formatEur(row.eligible_amount)}
                        </span>
                      {/if}
                    </TableCell>
                    <TableCell class="p-2 text-right align-top">
                      <Input
                        type="number"
                        bind:value={row.refund_amount}
                        min="0"
                        step="0.01"
                        class="w-28 text-right"
                        aria-label="Erstattungsbetrag für Kategorie {row.label}"
                      />
                    </TableCell>
                  </TableRow>
                {/each}
              </TableBody>
            </Table>
          </div>
        {:else}
          <div class="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ziffer</TableHead>
                  <TableHead>Beschreibung</TableHead>
                  <TableHead class="text-right">Betrag (€)</TableHead>
                  <TableHead class="w-32 text-right">Erstattet (€)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {#each refundRows as row (row.id)}
                  <TableRow>
                    <TableCell class="font-mono text-sm">{row.goae_number}</TableCell>
                    <TableCell class="max-w-xs text-sm whitespace-normal break-words"
                      >{row.description ?? '—'}</TableCell
                    >
                    <TableCell class="text-right tabular-nums text-sm align-top">
                      {formatEur(row.charged_amount)}
                      {#if row.eligible_amount != null}
                        <br /><span class="text-xs text-muted-foreground">
                          erstattungsfähig: {formatEur(row.eligible_amount)}
                        </span>
                      {/if}
                    </TableCell>
                    <TableCell class="p-2 text-right align-top">
                      <Input
                        type="number"
                        bind:value={row.refund_amount}
                        min="0"
                        step="0.01"
                        class="w-28 text-right"
                        aria-label="Erstattungsbetrag für Position {row.goae_number}"
                      />
                    </TableCell>
                  </TableRow>
                {/each}
              </TableBody>
            </Table>
          </div>
        {/if}

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div class="space-y-1.5">
            <Label for="refund-date">Erstattungsdatum</Label>
            <Input id="refund-date" type="date" bind:value={refundDate} />
          </div>
          <div class="space-y-1.5">
            <Label for="refund-note">Notiz (optional)</Label>
            <Textarea id="refund-note" bind:value={refundNote} rows={1} />
          </div>
        </div>

        {#if refundError}
          <Alert variant="destructive">
            <AlertDescription>{refundError}</AlertDescription>
          </Alert>
        {/if}

        <div class="flex flex-wrap gap-2">
          <Button onclick={submitRefund} disabled={refunding}>
            {refunding
              ? 'Wird gespeichert …'
              : refundFormMode === 'edit'
                ? 'Änderungen speichern'
                : 'Erstattung speichern'}
          </Button>
          <Button
            variant="outline"
            onclick={() => {
              showRefundForm = false;
              refundError = null;
            }}
            disabled={refunding}
          >
            Abbrechen
          </Button>
        </div>
      </div>
    {/if}

    <!-- Status history -->
    {#if eventsLoading}
      <p class="text-sm text-muted-foreground">Statusverlauf wird geladen …</p>
    {:else if eventsError}
      <p class="text-sm text-destructive">{eventsError}</p>
    {:else if events.length > 0}
      <div class="space-y-2">
        <p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Statusverlauf
        </p>
        <ol class="space-y-1.5">
          {#each events as ev (ev.id)}
            <li class="flex flex-wrap items-center gap-2 text-sm">
              <span class="shrink-0 tabular-nums text-xs text-muted-foreground">
                {formatTimestamp(ev.changed_at)}
              </span>
              <span class="shrink-0 text-xs text-muted-foreground">{TRACK_LABELS[ev.track]}</span>
              <InvoiceBadge status={ev.status} />
              {#if ev.note}
                <span class="truncate text-xs text-muted-foreground">{ev.note}</span>
              {/if}
            </li>
          {/each}
        </ol>
      </div>
    {/if}
  </CardContent>
</Card>
