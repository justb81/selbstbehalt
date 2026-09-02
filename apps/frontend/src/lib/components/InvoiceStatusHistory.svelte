<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  The append-only status-event audit trail of one invoice (docs/architecture.md §5.2):
  every event of all three tracks in recording order, labelled by track. Purely
  presentational — the loading is orchestrated by `InvoiceStatusFlow`, which reloads
  the events after each lifecycle action.
-->
<script lang="ts">
  import { formatDate, type InvoiceStatusEvent, type StatusTrack } from '@selbstbehalt/shared';
  import InvoiceBadge from './InvoiceBadge.svelte';

  let {
    events,
    loading,
    error,
  }: {
    events: InvoiceStatusEvent[];
    loading: boolean;
    error: string | null;
  } = $props();

  const TRACK_LABELS: Record<StatusTrack, string> = {
    review: 'Prüfung',
    payment: 'Zahlung',
    submission: 'Einreichung',
  };

  function formatTimestamp(iso: string): string {
    const d = formatDate(iso);
    const t = iso.slice(11, 16);
    return t ? `${d} ${t}` : d;
  }
</script>

{#if loading}
  <p class="text-sm text-muted-foreground">Statusverlauf wird geladen …</p>
{:else if error}
  <p class="text-sm text-destructive">{error}</p>
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
