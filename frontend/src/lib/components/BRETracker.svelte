<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  BRETracker (docs/design.md §6.2, issue #21): shows the BRE ladder progress for
  one insured person — current streak, projected refund and the next milestone.
-->
<script lang="ts">
  import {
    formatEur,
    getCurrentStreakYears,
    getNextLevel,
    getProjectedBRE,
    type InsuredPerson,
  } from '@selbstbehalt/shared';

  let {
    insuredPerson,
    compact = false,
  }: {
    insuredPerson: InsuredPerson;
    compact?: boolean;
  } = $props();

  const bre = $derived(insuredPerson.bre_structure);
  const streakYears = $derived(bre ? getCurrentStreakYears(bre) : 0);
  const projectedBRE = $derived(bre ? getProjectedBRE(bre, insuredPerson.monthly_premium) : 0);
  const nextLevel = $derived(bre ? getNextLevel(bre) : null);

  const progressPct = $derived(() => {
    if (!bre || !nextLevel) return 100;
    const target = nextLevel.level.leistungsfrei_years;
    return Math.min(100, Math.round((streakYears / target) * 100));
  });

  const label = $derived(insuredPerson.tariff_name ?? insuredPerson.kvnr ?? 'Versicherte Person');
</script>

<div class="bre-tracker" class:compact>
  <div class="tracker-header">
    <span class="tracker-label">{label}</span>
    {#if !compact}
      <span class="streak-value"
        >{streakYears} Jahr{streakYears === 1 ? '' : 'e'} leistungsfrei</span
      >
    {:else}
      <span class="streak-compact">{streakYears} J.</span>
    {/if}
  </div>

  {#if bre}
    <div
      class="progress-bar"
      role="progressbar"
      aria-valuenow={streakYears}
      aria-valuemin={0}
      aria-valuemax={nextLevel ? nextLevel.level.leistungsfrei_years : streakYears}
    >
      <div class="progress-fill" style="width: {progressPct()}%"></div>
    </div>

    {#if !compact}
      <div class="tracker-details">
        {#if nextLevel}
          <span class="next-level">
            Nächste Stufe in {nextLevel.yearsRemaining} Jahr{nextLevel.yearsRemaining === 1
              ? ''
              : 'en'}
            ({nextLevel.level.leistungsfrei_years} Jahr{nextLevel.level.leistungsfrei_years === 1
              ? ''
              : 'e'} →
            {#if nextLevel.level.fixed_amount_eur !== undefined}
              {formatEur(nextLevel.level.fixed_amount_eur)}
            {:else}
              {nextLevel.level.pct_of_premium} %
            {/if})
          </span>
        {:else}
          <span class="top-level">Höchste Stufe erreicht</span>
        {/if}
        {#if projectedBRE > 0}
          <span class="projected-bre"
            >Projizierte BRE: <strong>{formatEur(projectedBRE)}</strong></span
          >
        {/if}
      </div>
    {:else if projectedBRE > 0}
      <span class="projected-bre-compact">{formatEur(projectedBRE)}</span>
    {/if}
  {:else}
    <p class="no-bre">Keine BRE-Staffel konfiguriert.</p>
  {/if}
</div>

<style>
  .bre-tracker {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .bre-tracker.compact {
    padding: var(--space-2) var(--space-3);
    gap: var(--space-1);
  }

  .tracker-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .tracker-label {
    font-weight: 600;
    font-size: var(--font-size-sm);
    color: var(--color-text);
  }

  .streak-value {
    font-size: var(--font-size-sm);
    color: var(--color-primary-strong);
    font-weight: 500;
  }

  .streak-compact {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .progress-bar {
    height: 0.5rem;
    background: var(--color-border);
    border-radius: 999px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--color-primary);
    border-radius: 999px;
    transition: width 0.3s ease;
    min-width: 0.25rem;
  }

  .tracker-details {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .next-level,
  .top-level {
    color: var(--color-text-muted);
  }

  .projected-bre strong {
    color: var(--color-success);
  }

  .projected-bre-compact {
    font-size: var(--font-size-sm);
    color: var(--color-success);
    font-weight: 500;
  }

  .no-bre {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    font-style: italic;
  }
</style>
