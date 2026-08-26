<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Status badge for a single lifecycle-track value (docs/design.md §6.2, issue #22/#142).

  Besides the seven real event values it renders one **display-only** value,
  `nicht_erstattungsfaehig`: an invoice the tariff reimburses nothing for is shown as
  "Einreichen entfällt" rather than as a pending submission. It is derived at render
  time from the amounts (`isNonReimbursable`) and is never persisted — there is no such
  `invoice_status_events` value and no such submission state.
-->
<script lang="ts">
  import type { InvoiceStatusEventValue } from '@selbstbehalt/shared';
  import { Badge } from '$lib/components/ui/badge';
  import { cn } from '$lib/utils';

  /** A real event value, or the derived display-only "nothing to submit" state. */
  export type InvoiceBadgeStatus = InvoiceStatusEventValue | 'nicht_erstattungsfaehig';

  let { status }: { status: InvoiceBadgeStatus } = $props();

  const LABELS: Record<InvoiceBadgeStatus, string> = {
    neu: 'Neu',
    geprüft: 'Geprüft',
    offen: 'Offen',
    bezahlt: 'Bezahlt',
    nicht_eingereicht: 'Nicht eingereicht',
    eingereicht: 'Eingereicht',
    erstattet: 'Erstattet',
    nicht_erstattungsfaehig: 'Nicht erstattungsfähig',
  };

  type BadgeConfig = {
    variant: 'secondary' | 'outline' | 'destructive';
    class?: string;
  };

  const VARIANTS: Record<InvoiceBadgeStatus, BadgeConfig> = {
    neu: { variant: 'secondary' },
    geprüft: {
      variant: 'outline',
      class:
        'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-300',
    },
    offen: { variant: 'secondary' },
    bezahlt: {
      variant: 'outline',
      class:
        'border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-950 dark:text-green-300',
    },
    nicht_eingereicht: { variant: 'secondary' },
    eingereicht: {
      variant: 'outline',
      class:
        'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300',
    },
    erstattet: {
      variant: 'outline',
      class:
        'border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-950 dark:text-green-300',
    },
    nicht_erstattungsfaehig: { variant: 'outline' },
  };

  const config = $derived(VARIANTS[status]);
</script>

<Badge variant={config.variant} class={cn(config.class)}>
  {LABELS[status]}
</Badge>
