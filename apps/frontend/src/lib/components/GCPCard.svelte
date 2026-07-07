<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  GCPCard — Günstigerprüfungs-Ergebniskarte (docs/design.md §5.3, issue #22).
  Shows the decision (submit vs. self-pay), the full breakdown, an explanation
  and action buttons. The parent page owns the API calls; this component only
  renders the result and calls back.
-->
<script lang="ts">
  import { formatEur } from '@selbstbehalt/shared';
  import type { GCP_Result } from '$lib/utils/guenstiger-pruefung';
  import { cn } from '$lib/utils';
  import { Card, CardHeader, CardContent, CardFooter } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import {
    Collapsible,
    CollapsibleTrigger,
    CollapsibleContent,
  } from '$lib/components/ui/collapsible';

  let {
    result,
    onSubmit,
    onSelfPay,
    loading = false,
  }: {
    result: GCP_Result;
    onSubmit?: () => void;
    onSelfPay?: () => void;
    loading?: boolean;
  } = $props();

  const isSubmit = $derived(result.recommendation === 'einreichen');

  let breakdownOpen = $state(false);
</script>

<Card
  class={cn(
    'border-2',
    isSubmit
      ? 'border-primary bg-primary/5'
      : 'border-amber-500/60 bg-amber-50/40 dark:bg-amber-900/10',
  )}
>
  <CardHeader>
    <div class="flex items-start gap-3">
      <span
        aria-hidden="true"
        class={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl',
          isSubmit
            ? 'bg-primary/15 text-primary'
            : 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
        )}
      >
        {isSubmit ? '✓' : '€'}
      </span>
      <div>
        <strong
          class={cn(
            'block text-lg font-semibold',
            isSubmit ? 'text-primary' : 'text-amber-700 dark:text-amber-400',
          )}
        >
          {isSubmit ? 'Einreichen empfohlen' : 'Selbst zahlen empfohlen'}
        </strong>
        <div class="text-muted-foreground mt-1 text-sm">
          {#if result.netBenefitOfSubmitting > 0}
            Vorteil Einreichen: <strong class="text-foreground"
              >{formatEur(result.netBenefitOfSubmitting)}</strong
            >
          {:else if result.netBenefitOfSubmitting < 0}
            Vorteil Selbst zahlen: <strong class="text-foreground"
              >{formatEur(Math.abs(result.netBenefitOfSubmitting))}</strong
            >
          {:else}
            Beide Optionen gleichwertig
          {/if}
        </div>
      </div>
    </div>
  </CardHeader>

  <CardContent class="flex flex-col gap-3">
    <p class="text-muted-foreground text-sm leading-relaxed">{result.explanation}</p>

    <Collapsible bind:open={breakdownOpen}>
      <CollapsibleTrigger
        class="text-muted-foreground hover:text-primary cursor-pointer select-none text-sm transition-colors"
      >
        {breakdownOpen ? 'Rechenweg verbergen' : 'Rechenweg anzeigen'}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <dl
          class="bg-background mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-md p-3 text-sm"
        >
          <dt class="text-muted-foreground">Leistungsjahr</dt>
          <dd class="text-right font-medium tabular-nums">{result.breakdown.year}</dd>

          <dt class="text-muted-foreground">Erstattungsbetrag nach Selbstbehalt</dt>
          <dd class="text-right font-medium tabular-nums">
            {formatEur(result.breakdown.refundAfterDeductible)}
          </dd>

          <dt class="text-muted-foreground">Aktuelle Leistungsfreizeit</dt>
          <dd class="text-right font-medium tabular-nums">
            {result.breakdown.currentStreakYears} Jahr{result.breakdown.currentStreakYears === 1
              ? ''
              : 'e'}
          </dd>

          {#if result.breakdown.alreadyBroken}
            <dt class="col-span-2 text-xs text-amber-600 dark:text-amber-400">
              Staffel für dieses Leistungsjahr bereits gebrochen
            </dt>
          {/if}

          <dt class="text-muted-foreground">Barwert BRE-Verlust (NPV)</dt>
          <dd class="text-right font-medium tabular-nums">
            {formatEur(result.breakdown.lostBREValue_NPV)}
          </dd>

          {#if result.breakdown.ladderTerms[0]}
            <dt class="text-muted-foreground">Monate bis BRE-Auszahlung</dt>
            <dd class="text-right font-medium tabular-nums">
              {result.breakdown.ladderTerms[0].monthsToPayout}
            </dd>
          {/if}

          <dt class="text-muted-foreground">Diskontrate</dt>
          <dd class="text-right font-medium tabular-nums">
            {(result.breakdown.discountRate * 100).toFixed(1)} %
          </dd>
        </dl>
      </CollapsibleContent>
    </Collapsible>
  </CardContent>

  {#if onSubmit || onSelfPay}
    <CardFooter class="flex flex-wrap gap-2 pb-4">
      {#if onSubmit}
        <Button variant="default" onclick={onSubmit} disabled={loading}>
          {isSubmit ? 'Einreichen' : 'Trotzdem einreichen'}
        </Button>
      {/if}
      {#if onSelfPay}
        <Button variant="outline" onclick={onSelfPay} disabled={loading}>Selbst zahlen</Button>
      {/if}
    </CardFooter>
  {/if}
</Card>
