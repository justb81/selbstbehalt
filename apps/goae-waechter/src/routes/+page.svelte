<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  GOÄ-Wächter's one functional screen (issue #170): scan/upload an invoice via
  @selbstbehalt/medic-invoice-check's <InvoiceReview> (mode="create") — the
  result lands directly in the same reduced Rechnungskopf + GOÄ/GOZ position
  table used by apps/frontend. There is nothing to save here (no backend, no
  versicherte Person, no Notizen, no eligible_amount — see issue #166): a
  "Neue Rechnung prüfen" reset takes the place of a submit button.
-->
<script lang="ts">
  import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
  import type { ProviderType } from '@selbstbehalt/shared';
  import {
    InvoiceReview,
    type ReviewPositionRow,
    type ScanResult,
  } from '@selbstbehalt/medic-invoice-check';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent } from '$lib/components/ui/card';

  function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

  let invoiceDate = $state(todayIso());
  let invoiceNumber = $state('');
  let providerName = $state('');
  let providerType = $state<ProviderType>('arzt');
  let totalAmount = $state(0);
  let positions = $state<ReviewPositionRow[]>([]);
  let scanResult = $state<ScanResult | null>(null);

  const hasScan = $derived(scanResult !== null);

  /** "Neue Rechnung prüfen": there is nothing to save, so this resets the form
   *  back to a blank invoice instead. */
  function reset(): void {
    invoiceDate = todayIso();
    invoiceNumber = '';
    providerName = '';
    providerType = 'arzt';
    totalAmount = 0;
    positions = [];
    scanResult = null;
  }
</script>

<svelte:head>
  <title>GOÄ-Wächter · Arztrechnung prüfen</title>
</svelte:head>

<div class="space-y-2">
  <p class="text-xs font-semibold uppercase tracking-widest text-primary">GOÄ · GOZ</p>
  <h1 class="text-3xl font-bold tracking-tight text-balance">Arztrechnung prüfen</h1>
  <p class="text-muted-foreground text-pretty">
    Rechnung fotografieren oder als Bild/PDF hochladen — die GOÄ/GOZ-Prüfung (inkl. §5
    Steigerungsfaktor) läuft direkt in diesem Browser.
  </p>
</div>

<Alert class="border-primary/20 bg-primary/5">
  <ShieldCheckIcon class="size-4 text-primary" />
  <AlertDescription class="text-foreground/80">
    Ihr Bild verlässt nie dieses Gerät: Erkennung und Prüfung laufen vollständig lokal. Es wird
    nichts hochgeladen, nichts gespeichert und nichts an einen Server gesendet.
  </AlertDescription>
</Alert>

<Card>
  <CardContent>
    <InvoiceReview
      mode="create"
      bind:invoiceDate
      bind:invoiceNumber
      bind:providerName
      bind:providerType
      bind:totalAmount
      bind:positions
      bind:scanResult
    />

    {#if hasScan}
      <div class="flex justify-end pt-4">
        <Button variant="outline" onclick={reset}>Neue Rechnung prüfen</Button>
      </div>
    {/if}
  </CardContent>
</Card>
