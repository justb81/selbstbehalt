<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Track 2 of the invoice lifecycle (docs/architecture.md §5.2): Bezahlung an den Arzt.
  Runs in parallel to the submission track and unlocks once the invoice is geprüft.
  „Als bezahlt markieren" opens an inline date field, because the Zahlungsdatum may
  lie in the future for a Terminüberweisung (issue #288).
-->
<script lang="ts">
  import {
    formatDate,
    todayIso,
    type InvoiceStatus,
    type PaymentStatus,
  } from '@selbstbehalt/shared';
  import InvoiceBadge from './InvoiceBadge.svelte';
  import { Button } from '@selbstbehalt/ui/button';
  import { Input } from '@selbstbehalt/ui/input';
  import { Label } from '@selbstbehalt/ui/label';

  let {
    status,
    isGeprueft,
    busy,
    onChange,
    onOpenForm,
  }: {
    status: InvoiceStatus;
    isGeprueft: boolean;
    busy: boolean;
    onChange: (to: PaymentStatus, paidOn?: string) => void;
    /** The inline date form opened — a stale error from a previous action is dropped. */
    onOpenForm?: () => void;
  } = $props();

  let showPayForm = $state(false);
  let payDate = $state('');

  function openPayForm() {
    payDate = todayIso();
    onOpenForm?.();
    showPayForm = true;
  }

  /** Closes the inline form as soon as the invoice actually is bezahlt. */
  $effect(() => {
    if (status.payment === 'bezahlt') showPayForm = false;
  });
</script>

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
        <Button size="sm" onclick={() => onChange('bezahlt', payDate)} disabled={busy}>
          Speichern
        </Button>
        <Button variant="outline" size="sm" onclick={() => (showPayForm = false)} disabled={busy}>
          Abbrechen
        </Button>
      </div>
    {:else}
      <Button size="sm" onclick={openPayForm} disabled={busy}>Als bezahlt markieren</Button>
    {/if}
  {:else}
    <Button variant="outline" size="sm" onclick={() => onChange('offen')} disabled={busy}>
      Zahlung zurücknehmen
    </Button>
  {/if}
</div>
