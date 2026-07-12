<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Shared invoice list (docs/design.md §6.1, issue #22). Used by both the
  Rechnungsarchiv (`/invoices`) and the versicherte-Person detail page so the
  two stay visually and functionally identical.

  Filters:
  - Person — rendered as tabs when ≥2 insured persons exist (needs `persons`
    + `insuredPersons` to map an invoice's insured_person_id to a person). Every
    insured person is offered, including ones without invoices yet. Omit those
    props (e.g. on a page already scoped to one insured person) and the person
    filter disappears.
  - Art des Leistungserbringers (provider type) — a select, shown when ≥2
    distinct types are present. The type is also a table column.
  - Status and free-text search (Leistungserbringer / Rechnungsnummer).

  The whole table row is a link to the invoice detail (stretched-link: a real
  anchor whose ::after overlay covers the positioned row).
-->
<script lang="ts">
  import { resolve } from '$app/paths';
  import { SvelteSet } from 'svelte/reactivity';
  import {
    formatDate,
    formatEur,
    paymentStatusValues,
    providerTypeValues,
    submissionStatusValues,
    type InsuredPerson,
    type Invoice,
    type PaymentStatus,
    type Person,
    type ProviderType,
    type SubmissionStatus,
  } from '@selbstbehalt/shared';
  import InvoiceBadge from '$lib/components/InvoiceBadge.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from '$lib/components/ui/select';
  import { Tabs, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from '$lib/components/ui/table';

  let {
    invoices,
    persons = [],
    insuredPersons = [],
    newInvoiceHref,
    initialPayment = undefined,
    initialSubmission = undefined,
  }: {
    invoices: Invoice[];
    /** All persons — enables the Person filter tabs when the list spans ≥2 of them. */
    persons?: Person[];
    /** All insured persons — maps an invoice's insured_person_id to its person. */
    insuredPersons?: InsuredPerson[];
    /** When set, the empty state offers a button to create the first invoice. */
    newInvoiceHref?: string;
    /** Preselects the Zahlung filter (e.g. from a `?payment=` deep link). */
    initialPayment?: PaymentStatus;
    /** Preselects the Einreichung filter (e.g. from a `?submission=` deep link, issue #261). */
    initialSubmission?: SubmissionStatus;
  } = $props();

  const PAYMENT_LABELS: Record<PaymentStatus, string> = {
    offen: 'Offen',
    bezahlt: 'Bezahlt',
  };
  const SUBMISSION_LABELS: Record<SubmissionStatus, string> = {
    nicht_eingereicht: 'Nicht eingereicht',
    eingereicht: 'Eingereicht',
    erstattet: 'Erstattet',
  };

  const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
    arzt: 'Arzt',
    zahnarzt: 'Zahnarzt',
    kieferorthopaede: 'Kieferorthopäde',
    krankenhaus: 'Krankenhaus',
    sonstiges: 'Sonstiges',
  };

  const ALL = 'all';

  let personFilter = $state<string>(ALL);
  // Deliberately one-time seeds, not live bindings — the initial* props are deep-link
  // defaults; the selects below own the filters once the user touches them.
  // svelte-ignore state_referenced_locally
  let paymentFilter = $state<PaymentStatus | typeof ALL>(initialPayment ?? ALL);
  // svelte-ignore state_referenced_locally
  let submissionFilter = $state<SubmissionStatus | typeof ALL>(initialSubmission ?? ALL);
  let providerTypeFilter = $state<ProviderType | typeof ALL>(ALL);
  let searchQuery = $state('');

  // insured_person_id -> person_id, so an invoice can be traced to its person.
  const personIdByInsured = $derived(new Map(insuredPersons.map((ip) => [ip.id, ip.person_id])));

  // The persons who are insured somewhere (i.e. can own invoices), sorted by
  // name — the filter offers every such person, not only those who happen to
  // have an invoice already, so a person with none yet is still selectable.
  const personOptions = $derived.by(() => {
    const ids = new SvelteSet<string>();
    for (const ip of insuredPersons) ids.add(ip.person_id);
    return persons.filter((p) => ids.has(p.id)).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  });
  const showPersonFilter = $derived(personOptions.length >= 2);

  // Provider types present in this list — the Art filter appears only when it
  // can distinguish between at least two.
  const providerTypeOptions = $derived.by(() => {
    const present = new SvelteSet<ProviderType>();
    for (const inv of invoices) if (inv.provider_type) present.add(inv.provider_type);
    return providerTypeValues.filter((t) => present.has(t));
  });
  const showProviderTypeFilter = $derived(providerTypeOptions.length >= 2);

  const paymentItems = $derived([
    { value: ALL, label: 'Alle' },
    ...paymentStatusValues.map((s) => ({ value: s, label: PAYMENT_LABELS[s] })),
  ]);
  const submissionItems = $derived([
    { value: ALL, label: 'Alle' },
    ...submissionStatusValues.map((s) => ({ value: s, label: SUBMISSION_LABELS[s] })),
  ]);
  const providerTypeItems = $derived([
    { value: ALL, label: 'Alle' },
    ...providerTypeOptions.map((t) => ({ value: t, label: PROVIDER_TYPE_LABELS[t] })),
  ]);

  const filtered = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    return invoices
      .filter((inv) => {
        if (showPersonFilter && personFilter !== ALL) {
          if (personIdByInsured.get(inv.insured_person_id) !== personFilter) return false;
        }
        if (paymentFilter !== ALL && inv.status.payment !== paymentFilter) return false;
        if (submissionFilter !== ALL && inv.status.submission !== submissionFilter) return false;
        if (providerTypeFilter !== ALL && inv.provider_type !== providerTypeFilter) return false;
        if (q) {
          return (
            inv.provider_name.toLowerCase().includes(q) ||
            (inv.invoice_number?.toLowerCase().includes(q) ?? false)
          );
        }
        return true;
      })
      .sort((a, b) => (b.invoice_date ?? '').localeCompare(a.invoice_date ?? ''));
  });

  const total = $derived(filtered.reduce((sum, inv) => sum + inv.total_amount, 0));
</script>

{#if invoices.length === 0}
  <EmptyState compact message="Noch keine Rechnungen vorhanden.">
    {#snippet action()}
      {#if newInvoiceHref}
        <Button href={newInvoiceHref}>Erste Rechnung erfassen</Button>
      {/if}
    {/snippet}
  </EmptyState>
{:else}
  <div class="space-y-4">
    {#if showPersonFilter}
      <Tabs bind:value={personFilter}>
        <TabsList class="h-auto max-w-full flex-wrap justify-start">
          <TabsTrigger value={ALL}>Alle</TabsTrigger>
          {#each personOptions as person (person.id)}
            <TabsTrigger value={person.id}>{person.name}</TabsTrigger>
          {/each}
        </TabsList>
      </Tabs>
    {/if}

    <div class="flex flex-wrap items-end gap-3">
      <div class="flex flex-col gap-1.5">
        <Label for="invoice-payment-filter">Bezahlung</Label>
        <Select
          type="single"
          value={paymentFilter}
          onValueChange={(v: string) => (paymentFilter = (v as PaymentStatus | typeof ALL) || ALL)}
          items={paymentItems}
        >
          <SelectTrigger id="invoice-payment-filter" class="w-40">
            <SelectValue placeholder="Alle" />
          </SelectTrigger>
          <SelectContent>
            {#each paymentItems as item (item.value)}
              <SelectItem value={item.value} label={item.label} />
            {/each}
          </SelectContent>
        </Select>
      </div>

      <div class="flex flex-col gap-1.5">
        <Label for="invoice-submission-filter">Einreichung</Label>
        <Select
          type="single"
          value={submissionFilter}
          onValueChange={(v: string) =>
            (submissionFilter = (v as SubmissionStatus | typeof ALL) || ALL)}
          items={submissionItems}
        >
          <SelectTrigger id="invoice-submission-filter" class="w-44">
            <SelectValue placeholder="Alle" />
          </SelectTrigger>
          <SelectContent>
            {#each submissionItems as item (item.value)}
              <SelectItem value={item.value} label={item.label} />
            {/each}
          </SelectContent>
        </Select>
      </div>

      {#if showProviderTypeFilter}
        <div class="flex flex-col gap-1.5">
          <Label for="invoice-type-filter">Art</Label>
          <Select
            type="single"
            value={providerTypeFilter}
            onValueChange={(v: string) =>
              (providerTypeFilter = (v as ProviderType | typeof ALL) || ALL)}
            items={providerTypeItems}
          >
            <SelectTrigger id="invoice-type-filter" class="w-48">
              <SelectValue placeholder="Alle" />
            </SelectTrigger>
            <SelectContent>
              {#each providerTypeItems as item (item.value)}
                <SelectItem value={item.value} label={item.label} />
              {/each}
            </SelectContent>
          </Select>
        </div>
      {/if}

      <div class="flex flex-col gap-1.5 flex-1 min-w-56">
        <Label for="invoice-search">Suche</Label>
        <Input
          id="invoice-search"
          type="search"
          bind:value={searchQuery}
          placeholder="Leistungserbringer, Rechnungsnummer …"
        />
      </div>
    </div>

    {#if filtered.length === 0}
      <EmptyState compact message="Keine Rechnungen entsprechen dem Filter." />
    {:else}
      <div class="rounded-md border border-border shadow-sm overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Datum</TableHead>
              <TableHead>Leistungserbringer</TableHead>
              <TableHead>Art</TableHead>
              <TableHead class="text-right">Betrag</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {#each filtered as invoice (invoice.id)}
              <TableRow class="relative cursor-pointer">
                <TableCell class="text-muted-foreground text-sm">
                  {formatDate(invoice.invoice_date)}
                </TableCell>
                <TableCell class="font-medium">
                  <a
                    href={resolve('/invoices/[id]', { id: invoice.id })}
                    class="text-foreground no-underline after:absolute after:inset-0 hover:text-primary focus-visible:underline focus-visible:outline-none"
                  >
                    {invoice.provider_name}
                  </a>
                  {#if invoice.invoice_number}
                    <span class="block text-xs font-normal text-muted-foreground">
                      Nr. {invoice.invoice_number}
                    </span>
                  {/if}
                </TableCell>
                <TableCell>
                  {#if invoice.provider_type}
                    <Badge variant="outline">{PROVIDER_TYPE_LABELS[invoice.provider_type]}</Badge>
                  {:else}
                    <span class="text-muted-foreground">—</span>
                  {/if}
                </TableCell>
                <TableCell class="text-right font-medium tabular-nums">
                  {formatEur(invoice.total_amount)}
                </TableCell>
                <TableCell>
                  <div class="flex flex-wrap gap-1">
                    <InvoiceBadge status={invoice.status.payment} />
                    <InvoiceBadge status={invoice.status.submission} />
                  </div>
                </TableCell>
              </TableRow>
            {/each}
          </TableBody>
        </Table>
      </div>

      <p class="text-sm text-muted-foreground text-right">
        {filtered.length} Rechnung{filtered.length === 1 ? '' : 'en'} · Gesamt: {formatEur(total)}
      </p>
    {/if}
  </div>
{/if}
