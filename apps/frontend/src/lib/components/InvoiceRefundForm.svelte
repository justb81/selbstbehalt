<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Refund capture for the submission track (eingereicht → erstattet, and its „Bearbeiten"):
  two entry modes over the same per-position store. The insurer's Leistungsabrechnung
  usually reports one amount per Leistungsbereich, so „je Kategorie" (default) captures a
  single amount per category and distributes it across that category's positions, while
  „je Position" keeps the granular entry for itemised statements. Row building and the
  payload for both modes live in `$lib/utils/refund-rows.ts`.

  Mounting the component opens the form; `pending` is bound so the lifecycle tracks
  disable while the save runs.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import { formatEur, todayIso, type InvoiceWithPositions } from '@selbstbehalt/shared';
  import {
    buildCategoryRows,
    buildRefundRows,
    refundPositionsPayload,
    type CategoryRefundRow,
    type RefundEntryMode,
    type RefundFormMode,
    type RefundRow,
  } from '$lib/utils/refund-rows';
  import { Button } from '@selbstbehalt/ui/button';
  import { Input } from '@selbstbehalt/ui/input';
  import { Label } from '@selbstbehalt/ui/label';
  import { Textarea } from '@selbstbehalt/ui/textarea';
  import { Tabs, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
  import { Alert, AlertDescription } from '@selbstbehalt/ui/alert';
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
    mode,
    initialNote = '',
    pending = $bindable(false),
    onSaved,
    onCancel,
  }: {
    invoice: InvoiceWithPositions;
    mode: RefundFormMode;
    /** Note of the stored `erstattet` event, pre-filled when correcting. */
    initialNote?: string;
    pending?: boolean;
    onSaved: () => void | Promise<void>;
    onCancel: () => void;
  } = $props();

  // The form is a snapshot taken when it opens: the rows stay editable afterwards and
  // must not be rebuilt when the page refetches the invoice underneath them.
  let entryMode = $state<RefundEntryMode>('category');
  let refundRows = $state<RefundRow[]>(untrack(() => buildRefundRows(invoice, mode)));
  let categoryRows = $state<CategoryRefundRow[]>(untrack(() => buildCategoryRows(invoice, mode)));
  let refundDate = $state(todayIso());
  let refundNote = $state(untrack(() => initialNote));
  let error = $state<string | null>(null);
  /** The stored refund date could not be read — saving would overwrite it (#396). */
  let refundDateUnknown = $state(false);

  onMount(async () => {
    if (mode !== 'edit') return;
    try {
      const submission = await api.invoices.getSubmission(invoice.id);
      if (submission.refund_date) refundDate = submission.refund_date;
    } catch (e) {
      // Only a 404 genuinely means "there is no submission" (shouldn't happen
      // once erstattet) — there the pre-filled today's date is a sane default.
      // Every other failure leaves us not knowing the stored date, and saving
      // would silently overwrite it with today (issue #396): blank the field
      // and block the save until it could be read.
      if (e instanceof ApiError && e.status === 404) return;
      refundDate = '';
      refundDateUnknown = true;
      error =
        'Das gespeicherte Erstattungsdatum konnte nicht geladen werden. Zum Schutz vor einem versehentlichen Überschreiben ist das Speichern gesperrt — bitte erneut versuchen.';
    }
  });

  async function save() {
    pending = true;
    error = null;
    try {
      await api.invoices.refund(invoice.id, {
        positions: refundPositionsPayload(invoice, entryMode, refundRows, categoryRows),
        refund_date: refundDate || null,
        note: refundNote.trim() || null,
      });
    } catch (e) {
      error =
        e instanceof ApiError || e instanceof Error
          ? e.message
          : 'Erstattung konnte nicht gespeichert werden.';
      return;
    } finally {
      pending = false;
    }
    // Outside the try: `onSaved` closes the form, and a write to the bound `pending`
    // after the unmount would never reach the parent — leaving the tracks disabled.
    await onSaved();
  }
</script>

<div class="rounded-md border border-border bg-muted/20 p-4 space-y-4">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <p class="text-sm font-medium">
      {mode === 'edit' ? 'Erstattungsbeträge korrigieren' : 'Erstattungsbeträge erfassen'}
    </p>
    <Tabs bind:value={entryMode}>
      <TabsList>
        <TabsTrigger value="category">Je Kategorie</TabsTrigger>
        <TabsTrigger value="position">Je Position</TabsTrigger>
      </TabsList>
    </Tabs>
  </div>
  <p class="text-xs text-muted-foreground">
    {entryMode === 'category'
      ? 'Betrag je Kategorie laut Leistungsabrechnung; wird auf die Positionen verteilt. 0 = abgelehnt.'
      : 'Betrag je Position. 0 = abgelehnt. Vorbefüllt mit dem erstattungsfähigen Betrag.'}
  </p>

  {#if invoice.positions.length === 0}
    <p class="text-sm text-muted-foreground">Keine Positionen vorhanden.</p>
  {:else if entryMode === 'category'}
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

  {#if error}
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  {/if}

  <div class="flex flex-wrap gap-2">
    <Button onclick={save} disabled={pending || refundDateUnknown}>
      {pending
        ? 'Wird gespeichert …'
        : mode === 'edit'
          ? 'Änderungen speichern'
          : 'Erstattung speichern'}
    </Button>
    <Button variant="outline" onclick={onCancel} disabled={pending}>Abbrechen</Button>
  </div>
</div>
