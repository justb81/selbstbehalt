<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  GCPContributionCard (docs/design.md §6.2, issue #134 Teil B):
  Shows how this invoice's positions contribute to the Günstigerprüfung verdict
  per affected service year. Links to the full year verdict on the insured person's page.
  Replaces the standalone GCPCard on the invoice detail page.
-->
<script lang="ts">
  import { resolve } from '$app/paths';
  import { formatEur } from '@selbstbehalt/shared';
  import { cn } from '$lib/utils';
  import { Card, CardContent, CardHeader } from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';

  interface YearContribution {
    /** Service year Y (from treatment_date). */
    year: number;
    /** This invoice's share of R_Y for year Y. */
    amount: number;
    /** The total R_Y across all invoices of the insured person for year Y. */
    totalR_Y: number;
    /** Annual Selbstbehalt. */
    selbstbehalt: number;
    /** Whether the BRE streak for this year is already broken by a prior refund. */
    alreadyBroken: boolean;
  }

  let {
    contributions,
    insuredPersonId,
    insuredLabel = 'Versicherte Person',
  }: {
    contributions: YearContribution[];
    insuredPersonId: string;
    insuredLabel?: string;
  } = $props();
</script>

<div class="space-y-2">
  <h2 class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
    Günstigerprüfung — Beitrag dieser Rechnung
  </h2>

  {#if contributions.length === 0}
    <div
      class="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
    >
      Keine Positionen mit Leistungsdatum — Günstigerprüfung nicht möglich.
    </div>
  {:else}
    {#each contributions as c (c.year)}
      {@const overThreshold = c.totalR_Y > c.selbstbehalt}
      {@const shareOfThreshold = c.selbstbehalt > 0 ? c.amount / c.selbstbehalt : 1}
      <Card
        class={cn(
          'border',
          overThreshold ? 'border-primary/40 bg-primary/5' : 'border-border bg-muted/20',
        )}
      >
        <CardHeader class="pb-2 pt-4">
          <div class="flex items-center justify-between gap-3 flex-wrap">
            <div class="flex items-center gap-2">
              <span class="font-semibold text-sm">Leistungsjahr {c.year}</span>
              {#if c.alreadyBroken}
                <Badge
                  variant="outline"
                  class="border-amber-500/60 text-amber-700 dark:text-amber-400 text-xs"
                >
                  Staffel gebrochen
                </Badge>
              {/if}
            </div>
            <a
              href={resolve('/insured/[id]', { id: insuredPersonId })}
              class="flex items-center gap-1 text-xs text-primary hover:underline no-underline"
            >
              Vollständiges Verdikt ({insuredLabel})
              <ArrowRightIcon class="size-3 shrink-0" />
            </a>
          </div>
        </CardHeader>

        <CardContent class="pb-4">
          <dl class="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            <dt class="text-muted-foreground">Beitrag dieser Rechnung</dt>
            <dd class="text-right font-medium tabular-nums">{formatEur(c.amount)}</dd>

            <dt class="text-muted-foreground">Gesamt-R_Y (alle Rechnungen)</dt>
            <dd class="text-right font-medium tabular-nums">{formatEur(c.totalR_Y)}</dd>

            <dt class="text-muted-foreground">Jahres-Selbstbehalt</dt>
            <dd class="text-right font-medium tabular-nums">{formatEur(c.selbstbehalt)}</dd>
          </dl>

          <div class="mt-3 text-sm">
            {#if c.alreadyBroken}
              <p class="text-amber-700 dark:text-amber-400">
                Die BRE-Staffel für {c.year} ist bereits durch eine Erstattung gebrochen — Einreichen
                ohne BRE-Abzug sinnvoll.
              </p>
            {:else if overThreshold}
              <p class="text-primary">
                Gesamt-Erstattungsbetrag {formatEur(c.totalR_Y)} übersteigt den Selbstbehalt von
                {formatEur(c.selbstbehalt)} — Einreichen könnte lohnend sein.
              </p>
            {:else}
              <p class="text-muted-foreground">
                Gesamt-Erstattungsbetrag {formatEur(c.totalR_Y)} liegt noch unter dem Selbstbehalt von
                {formatEur(c.selbstbehalt)}
                {#if shareOfThreshold < 1}
                  (diese Rechnung: {Math.round(shareOfThreshold * 100)} % des Selbstbehalts){/if}.
              </p>
            {/if}
          </div>
        </CardContent>
      </Card>
    {/each}
  {/if}
</div>
