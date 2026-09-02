<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Track 3 of the invoice lifecycle (docs/architecture.md §5.2): Einreichung / Erstattung,
  including the step-back control from issue #230 (delete the last submission step) and
  the demotion of „Einreichen" for an invoice the tariff reimburses nothing for (#381).
  Runs in parallel to the payment track and unlocks once the invoice is geprüft.

  Owns the revert call and its confirmation dialog; `reverting` is bound so the sibling
  tracks disable while it runs. Capturing a refund and editing the submission are handed
  back up — both live outside this card.
-->
<script lang="ts">
  import { api, ApiError } from '$lib/api';
  import type { InvoiceStatus } from '@selbstbehalt/shared';
  import InvoiceBadge from './InvoiceBadge.svelte';
  import { Button } from '@selbstbehalt/ui/button';
  import { Alert, AlertDescription } from '@selbstbehalt/ui/alert';
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

  let {
    invoiceId,
    status,
    isGeprueft,
    nothingToSubmit,
    busy,
    reverting = $bindable(false),
    onSubmitStep,
    onCaptureRefund,
    onReverted,
  }: {
    invoiceId: string;
    status: InvoiceStatus;
    isGeprueft: boolean;
    /** The tariff reimburses nothing here — submitting stays possible, but has no upside. */
    nothingToSubmit: boolean;
    busy: boolean;
    reverting?: boolean;
    onSubmitStep: () => void;
    onCaptureRefund: (mode: 'create' | 'edit') => void;
    onReverted: () => void | Promise<void>;
  } = $props();

  const REVERT_WARNING: Record<'eingereicht' | 'erstattet', string> = {
    eingereicht:
      'Die erfasste Einreichung wird gelöscht; der Status wird auf „Nicht eingereicht" zurückgesetzt.',
    erstattet:
      'Die erfassten Erstattungsbeträge werden gelöscht; der Status wird auf „Eingereicht" zurückgesetzt.',
  };

  const destructiveOutline = 'border-destructive text-destructive hover:bg-destructive/10';

  let confirmRevert = $state(false);
  let revertError = $state<string | null>(null);

  async function revertSubmission() {
    reverting = true;
    revertError = null;
    try {
      await api.invoices.revertSubmission(invoiceId, {});
      confirmRevert = false;
      await onReverted();
    } catch (e) {
      revertError =
        e instanceof ApiError || e instanceof Error
          ? e.message
          : 'Rückgängig machen fehlgeschlagen.';
    } finally {
      reverting = false;
    }
  }
</script>

<div class="rounded-md border border-border p-3 space-y-2">
  <div class="flex flex-wrap items-center gap-2">
    <span class="text-sm font-medium">Einreichung / Erstattung</span>
    <InvoiceBadge status={nothingToSubmit ? 'nicht_erstattungsfaehig' : status.submission} />
  </div>
  {#if !isGeprueft}
    <p class="text-xs text-muted-foreground">Erst nach der Prüfung möglich.</p>
  {:else if nothingToSubmit}
    <p class="text-xs text-muted-foreground">
      Der Tarif erstattet für diese Rechnung nichts — Einreichen entfällt.
    </p>
    <Button variant="outline" size="sm" onclick={onSubmitStep} disabled={busy}>
      Trotzdem einreichen …
    </Button>
  {:else if status.submission === 'nicht_eingereicht'}
    <Button size="sm" onclick={onSubmitStep} disabled={busy}>Einreichen …</Button>
  {:else if status.submission === 'eingereicht'}
    <div class="flex flex-wrap gap-2">
      <Button size="sm" onclick={() => onCaptureRefund('create')} disabled={busy}>
        Erstattung erfassen
      </Button>
      <Button variant="outline" size="sm" onclick={onSubmitStep} disabled={busy}>
        Einreichung bearbeiten
      </Button>
      <Button
        variant="outline"
        size="sm"
        class={destructiveOutline}
        onclick={() => (confirmRevert = true)}
        disabled={busy}
      >
        Einreichung löschen
      </Button>
    </div>
  {:else}
    <div class="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onclick={() => onCaptureRefund('edit')} disabled={busy}>
        Erstattung bearbeiten
      </Button>
      <Button
        variant="outline"
        size="sm"
        class={destructiveOutline}
        onclick={() => (confirmRevert = true)}
        disabled={busy}
      >
        Erstattung löschen
      </Button>
    </div>
  {/if}
</div>

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
        {status.submission === 'erstattet' ? REVERT_WARNING.erstattet : REVERT_WARNING.eingereicht}
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
