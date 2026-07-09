<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  BRETracker (docs/design.md §6.2, issue #21): shows the BRE ladder progress for
  one insured person — current streak, projected refund and the next milestone.
  In compact mode an optional href turns the card into a navigation link. `bare`
  renders just the streak/progress body with no card wrapper or name header — for
  composing into `PersonStatusCard` (issue #261).
-->
<script lang="ts">
  import {
    formatEur,
    getCurrentStreakYears,
    getNextLevel,
    getProjectedBRE,
    type InsuredPerson,
  } from '@selbstbehalt/shared';
  import { Progress } from '$lib/components/ui/progress';
  import { cn } from '$lib/utils';

  let {
    insuredPerson,
    compact = false,
    bare = false,
    href = undefined,
  }: {
    insuredPerson: InsuredPerson;
    compact?: boolean;
    bare?: boolean;
    href?: string;
  } = $props();

  const bre = $derived(insuredPerson.bre_structure);
  const streakYears = $derived(bre ? getCurrentStreakYears(bre) : 0);
  const projectedBRE = $derived(bre ? getProjectedBRE(bre, insuredPerson.monthly_premium) : 0);
  const nextLevel = $derived(bre ? getNextLevel(bre) : null);

  const progressPct = $derived(() => {
    if (!bre || !nextLevel) return 100;
    const target = nextLevel.level.claim_free_years;
    return Math.min(100, Math.round((streakYears / target) * 100));
  });

  // Short milestone hint for the compact/bare progress bar (issue #261) — the
  // full variant already spells this out in its own line below the bar.
  const nextLevelHint = $derived(
    !bre
      ? undefined
      : nextLevel
        ? `Nächste Stufe in ${nextLevel.yearsRemaining} Jahr${nextLevel.yearsRemaining === 1 ? '' : 'en'}`
        : 'Höchste Stufe erreicht',
  );
  // Accessible name for the progress bar — role="progressbar" needs one (axe
  // aria-progressbar-name); aria-valuetext alone does not count as a name.
  const progressAriaLabel = $derived(
    nextLevel
      ? `BRE-Staffel: ${streakYears} von ${nextLevel.level.claim_free_years} Jahren leistungsfrei`
      : 'BRE-Staffel: höchste Stufe erreicht',
  );

  const label = $derived(insuredPerson.tariff_name ?? insuredPerson.kvnr ?? 'Versicherte Person');

  const cardClass = $derived(
    cn(
      'flex flex-col border border-border rounded-xl bg-card text-card-foreground',
      compact ? 'gap-1 px-3 py-2' : 'gap-2 p-3',
      href && compact ? 'hover:border-primary transition-colors no-underline text-foreground' : '',
    ),
  );
</script>

{#snippet progressBar()}
  <Progress
    value={progressPct()}
    max={100}
    aria-label={progressAriaLabel}
    title={nextLevelHint}
    aria-valuenow={streakYears}
    aria-valuemin={0}
    aria-valuemax={nextLevel ? nextLevel.level.claim_free_years : streakYears}
  />
{/snippet}

{#snippet bareInner()}
  <div class="flex flex-wrap items-center justify-between gap-2">
    <span class="text-sm font-medium text-primary">
      {streakYears} Jahr{streakYears === 1 ? '' : 'e'} leistungsfrei
    </span>
    {#if projectedBRE > 0}
      <span class="text-sm font-medium text-green-600 dark:text-green-400">
        BRE: {formatEur(projectedBRE)}
      </span>
    {/if}
  </div>
  {#if bre}
    {@render progressBar()}
    <span class="text-xs text-muted-foreground">{nextLevelHint}</span>
  {:else}
    <p class="m-0 text-sm text-muted-foreground italic">Keine BRE-Staffel konfiguriert.</p>
  {/if}
{/snippet}

{#snippet inner()}
  <div class="flex justify-between items-center gap-2 flex-wrap">
    <span class="font-semibold text-sm text-foreground">{label}</span>
    {#if !compact}
      <span class="text-sm font-medium text-primary">
        {streakYears} Jahr{streakYears === 1 ? '' : 'e'} leistungsfrei
      </span>
    {:else}
      <span class="text-sm text-muted-foreground">{streakYears} J.</span>
    {/if}
  </div>

  {#if bre}
    {@render progressBar()}

    {#if !compact}
      <div class="flex flex-col gap-1 text-sm text-muted-foreground">
        {#if nextLevel}
          <span>
            Nächste Stufe in {nextLevel.yearsRemaining} Jahr{nextLevel.yearsRemaining === 1
              ? ''
              : 'en'}
            ({nextLevel.level.claim_free_years} Jahr{nextLevel.level.claim_free_years === 1
              ? ''
              : 'e'} →
            {#if nextLevel.level.fixed_amount_eur !== undefined}
              {formatEur(nextLevel.level.fixed_amount_eur)}
            {:else}
              {nextLevel.level.pct_of_premium} %
            {/if})
          </span>
        {:else}
          <span>Höchste Stufe erreicht</span>
        {/if}
        {#if projectedBRE > 0}
          <span
            >Projizierte BRE: <strong class="text-green-600 dark:text-green-400"
              >{formatEur(projectedBRE)}</strong
            ></span
          >
        {/if}
      </div>
    {:else}
      {#if projectedBRE > 0}
        <span class="text-sm font-medium text-green-600 dark:text-green-400">
          BRE: {formatEur(projectedBRE)}
        </span>
      {/if}
      <span class="text-[11px] text-muted-foreground">{nextLevelHint}</span>
    {/if}
  {:else}
    <p class="m-0 text-sm text-muted-foreground italic">Keine BRE-Staffel konfiguriert.</p>
  {/if}
{/snippet}

{#if bare}
  {@render bareInner()}
{:else if href && compact}
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- href is pre-resolved by caller -->
  <a {href} class={cardClass}>
    {@render inner()}
  </a>
{:else}
  <div class={cardClass}>
    {@render inner()}
  </div>
{/if}
