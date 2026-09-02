<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Track 1 of the invoice lifecycle (docs/architecture.md §5.2): Prüfung.
  `geprüft` unlocks the payment and submission tracks, so it can only be taken
  back while both of them are still at their ground state.
-->
<script lang="ts">
  import type { InvoiceStatus, ReviewStatus } from '@selbstbehalt/shared';
  import InvoiceBadge from './InvoiceBadge.svelte';
  import { Button } from '@selbstbehalt/ui/button';

  let {
    status,
    busy,
    onChange,
  }: {
    status: InvoiceStatus;
    busy: boolean;
    onChange: (to: ReviewStatus) => void;
  } = $props();
</script>

<div class="rounded-md border border-border p-3 space-y-2">
  <div class="flex flex-wrap items-center gap-2">
    <span class="text-sm font-medium">Prüfung</span>
    <InvoiceBadge status={status.review} />
  </div>
  <div class="flex flex-wrap gap-2">
    {#if status.review === 'neu'}
      <Button size="sm" onclick={() => onChange('geprüft')} disabled={busy}>
        Als geprüft markieren
      </Button>
    {:else}
      <Button
        variant="outline"
        size="sm"
        onclick={() => onChange('neu')}
        disabled={busy || status.payment !== 'offen' || status.submission !== 'nicht_eingereicht'}
      >
        Prüfung zurücknehmen
      </Button>
    {/if}
  </div>
</div>
