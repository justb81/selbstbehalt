<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Status badge for an invoice (docs/design.md §6.2, issue #22). -->
<script lang="ts">
  import type { InvoiceStatus } from '@selbstbehalt/shared';

  let { status }: { status: InvoiceStatus } = $props();

  const LABELS: Record<InvoiceStatus, string> = {
    neu: 'Neu',
    geprüft: 'Geprüft',
    eingereicht: 'Eingereicht',
    erstattet: 'Erstattet',
    abgelehnt: 'Abgelehnt',
    selbst_gezahlt: 'Selbst gezahlt',
  };

  const VARIANTS: Record<InvoiceStatus, string> = {
    neu: 'neutral',
    geprüft: 'info',
    eingereicht: 'warning',
    erstattet: 'success',
    abgelehnt: 'danger',
    selbst_gezahlt: 'muted',
  };
</script>

<span class="badge {VARIANTS[status]}">{LABELS[status]}</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    padding: 0.15em 0.65em;
    border-radius: 999px;
    font-size: var(--font-size-sm);
    font-weight: 500;
    line-height: 1.5;
    white-space: nowrap;
  }

  .neutral {
    background: var(--color-bg);
    color: var(--color-text-muted);
    border: 1px solid var(--color-border);
  }

  .info {
    background: var(--color-primary-soft);
    color: var(--color-primary-strong);
  }

  .warning {
    background: color-mix(in srgb, var(--color-warning) 14%, var(--color-surface));
    color: var(--color-warning);
  }

  .success {
    background: color-mix(in srgb, var(--color-success) 14%, var(--color-surface));
    color: var(--color-success);
  }

  .danger {
    background: color-mix(in srgb, var(--color-danger) 14%, var(--color-surface));
    color: var(--color-danger);
  }

  .muted {
    background: var(--color-bg);
    color: var(--color-text-muted);
    border: 1px solid var(--color-border);
  }
</style>
