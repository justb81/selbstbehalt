<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Fälligkeits-Badge für eine Rechnung (issue #288): markiert überfällige und bald
  fällige Zahlungen sowie Terminüberweisungen. Rendert nichts, solange nichts
  anzumerken ist (offen/bezahlt) oder die Hinweise deaktiviert sind — deshalb
  gefahrlos in jede Statuszelle einsetzbar.
-->
<script lang="ts">
  import { formatDate, type Invoice, type PaymentDueState } from '@selbstbehalt/shared';
  import { Badge } from '$lib/components/ui/badge';
  import { cn } from '$lib/utils';
  import { classifyInvoiceDue, type PaymentDueOptions } from '$lib/utils/payment-reminders';

  let {
    invoice,
    leadDays,
    termDays,
    asOf = undefined,
  }: {
    invoice: Invoice;
    /** Reminder lead time in days, or `null` when Fälligkeits-Hinweise are off. */
    leadDays: number | null;
    /** Standard-Zahlungsfrist for invoices without a stored Zahlungsziel. */
    termDays: number;
    /** Reference day; defaults to today. */
    asOf?: PaymentDueOptions['asOf'];
  } = $props();

  const due = $derived(classifyInvoiceDue(invoice, { leadDays, termDays, asOf }));

  /** Amber = needs attention soon, destructive = already missed. */
  const ATTENTION =
    'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300';

  const label = $derived.by(() => {
    const { state, days, dueDate } = due;
    switch (state) {
      case 'ueberfaellig': {
        const overdueDays = -days;
        return `${overdueDays} Tag${overdueDays === 1 ? '' : 'e'} überfällig`;
      }
      case 'faellig_bald':
        return days === 0 ? 'Heute fällig' : `Fällig in ${days} Tag${days === 1 ? '' : 'en'}`;
      case 'terminiert':
        return `Zahlung terminiert zum ${formatDate(invoice.status.paid_on)}`;
      case 'terminiert_spaet':
        return `Zahlungstermin nach Zahlungsziel ${formatDate(dueDate)}`;
      default:
        return null;
    }
  });

  const CLASSES: Partial<Record<PaymentDueState, string>> = {
    faellig_bald: ATTENTION,
    terminiert_spaet: ATTENTION,
  };

  const variant = $derived(due.state === 'ueberfaellig' ? 'destructive' : 'outline');
</script>

{#if label}
  <Badge {variant} class={cn(CLASSES[due.state])}>{label}</Badge>
{/if}
