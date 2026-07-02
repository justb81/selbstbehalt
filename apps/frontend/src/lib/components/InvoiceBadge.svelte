<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Status badge for an invoice (docs/design.md §6.2, issue #22). -->
<script lang="ts">
  import type { InvoiceStatus } from '@selbstbehalt/shared';
  import { Badge } from '$lib/components/ui/badge';
  import { cn } from '$lib/utils';

  let { status }: { status: InvoiceStatus } = $props();

  const LABELS: Record<InvoiceStatus, string> = {
    neu: 'Neu',
    geprüft: 'Geprüft',
    bezahlt: 'Bezahlt',
    eingereicht: 'Eingereicht',
    erstattet: 'Erstattet',
  };

  type BadgeConfig = {
    variant: 'secondary' | 'outline' | 'destructive';
    class?: string;
  };

  const VARIANTS: Record<InvoiceStatus, BadgeConfig> = {
    neu: { variant: 'secondary' },
    geprüft: {
      variant: 'outline',
      class:
        'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-300',
    },
    bezahlt: { variant: 'secondary' },
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
  };

  const config = $derived(VARIANTS[status]);
</script>

<Badge variant={config.variant} class={cn(config.class)}>
  {LABELS[status]}
</Badge>
