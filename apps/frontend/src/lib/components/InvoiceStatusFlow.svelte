<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  InvoiceStatusFlow (docs/design.md §6.2, issue #142):
  Shows the current invoice status, the allowed transitions as action buttons,
  the per-position refund-entry form (for the eingereicht → erstattet step),
  and the full status-event audit trail.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import {
    formatEur,
    type InvoiceWithPositions,
    type InvoiceStatusEvent,
    type InvoiceStatus,
  } from '@selbstbehalt/shared';
  import InvoiceBadge from './InvoiceBadge.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';
  import { Card, CardContent, CardHeader } from '$lib/components/ui/card';
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

  // ---- Transition logic ----------------------------------------------------

  const ALLOWED_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
    neu: ['geprüft'],
    geprüft: ['neu', 'bezahlt'],
    bezahlt: ['eingereicht'],
    eingereicht: ['erstattet'],
    erstattet: [],
  };

  const BUTTON_LABEL: Record<string, string> = {
    'neu→geprüft': 'Als geprüft markieren',
    'geprüft→neu': 'Zurück zu Neu',
    'geprüft→bezahlt': 'Als bezahlt markieren',
    'bezahlt→eingereicht': 'Einreichen …',
    'eingereicht→erstattet': 'Erstattung erfassen',
  };

  const BUTTON_VARIANT: Record<string, 'default' | 'outline' | 'secondary'> = {
    'geprüft→neu': 'outline',
    'bezahlt→eingereicht': 'default',
  };

  let actioning = $state(false);
  let actionError = $state<string | null>(null);

  async function doTransition(to: InvoiceStatus) {
    actionError = null;
    if (to === 'eingereicht') {
      await goto(resolve('/invoices/[id]/submit', { id: invoice.id }));
      return;
    }
    if (to === 'erstattet') {
      openRefundForm();
      return;
    }
    actioning = true;
    try {
      await api.invoices.changeStatus(invoice.id, { status: to });
      await loadEvents();
      onChanged();
    } catch (e) {
      actionError =
        e instanceof ApiError || e instanceof Error ? e.message : 'Statuswechsel fehlgeschlagen.';
    } finally {
      actioning = false;
    }
  }

  // ---- Refund capture (eingereicht → erstattet) ----------------------------

  type RefundRow = {
    id: string;
    goae_number: string;
    description: string | null;
    charged_amount: number;
    eligible_amount: number | null;
    refund_amount: number;
  };

  let showRefundForm = $state(false);
  let refundRows = $state<RefundRow[]>([]);
  let refundDate = $state('');
  let refundNote = $state('');
  let refunding = $state(false);
  let refundError = $state<string | null>(null);

  function openRefundForm() {
    refundRows = invoice.positions.map((p) => ({
      id: p.id,
      goae_number: p.goae_number,
      description: p.description ?? null,
      charged_amount: p.charged_amount,
      eligible_amount: p.eligible_amount ?? null,
      refund_amount: p.eligible_amount ?? p.charged_amount,
    }));
    refundDate = new Date().toISOString().slice(0, 10);
    refundNote = '';
    refundError = null;
    showRefundForm = true;
  }

  async function submitRefund() {
    refunding = true;
    refundError = null;
    try {
      await api.invoices.refund(invoice.id, {
        positions: refundRows.map((r) => ({ id: r.id, refund_amount: r.refund_amount })),
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
    const d = iso.slice(0, 10).split('-').reverse().join('.');
    const t = iso.slice(11, 16);
    return t ? `${d} ${t}` : d;
  }

  const transitions = $derived(ALLOWED_TRANSITIONS[invoice.status] ?? []);
</script>

<Card>
  <CardHeader class="pb-3">
    <div class="flex flex-wrap items-center gap-3">
      <p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Status</p>
      <InvoiceBadge status={invoice.status} />
    </div>
  </CardHeader>
  <CardContent class="space-y-4">
    <!-- Transition action buttons -->
    {#if transitions.length > 0}
      <div class="flex flex-wrap gap-2">
        {#each transitions as to (to)}
          {@const key = `${invoice.status}→${to}`}
          <Button
            variant={BUTTON_VARIANT[key] ?? 'default'}
            size="sm"
            onclick={() => doTransition(to)}
            disabled={actioning || refunding}
          >
            {BUTTON_LABEL[key] ?? to}
          </Button>
        {/each}
      </div>
    {/if}

    {#if actionError}
      <Alert variant="destructive">
        <AlertDescription>{actionError}</AlertDescription>
      </Alert>
    {/if}

    <!-- Refund capture form (eingereicht → erstattet) -->
    {#if showRefundForm}
      <div class="rounded-md border border-border bg-muted/20 p-4 space-y-4">
        <p class="text-sm font-medium">Erstattungsbeträge je Position erfassen</p>
        <p class="text-xs text-muted-foreground">
          Betrag 0 = abgelehnt. Vorbefüllt mit dem erstattungsfähigen Betrag je Position.
        </p>

        {#if invoice.positions.length > 0}
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
        {:else}
          <p class="text-sm text-muted-foreground">Keine Positionen vorhanden.</p>
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
            {refunding ? 'Wird gespeichert …' : 'Erstattung speichern'}
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
