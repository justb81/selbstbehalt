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
</script>

<div class="gcp-card" class:submit={isSubmit} class:self-pay={!isSubmit}>
  <div class="gcp-header">
    <span class="gcp-icon" aria-hidden="true">{isSubmit ? '✓' : '€'}</span>
    <div>
      <strong class="gcp-recommendation">
        {isSubmit ? 'Einreichen empfohlen' : 'Selbst zahlen empfohlen'}
      </strong>
      <div class="gcp-net">
        {#if result.netBenefitOfSubmitting > 0}
          Vorteil Einreichen: <strong>{formatEur(result.netBenefitOfSubmitting)}</strong>
        {:else if result.netBenefitOfSubmitting < 0}
          Vorteil Selbst zahlen: <strong
            >{formatEur(Math.abs(result.netBenefitOfSubmitting))}</strong
          >
        {:else}
          Beide Optionen gleichwertig
        {/if}
      </div>
    </div>
  </div>

  <p class="gcp-explanation">{result.explanation}</p>

  <details class="gcp-breakdown">
    <summary>Rechenweg anzeigen</summary>
    <dl class="breakdown-grid">
      <dt>Erstattungsbetrag nach Selbstbehalt</dt>
      <dd>{formatEur(result.breakdown.refundAfterDeductible)}</dd>

      <dt>Aktuelle Leistungsfreizeit</dt>
      <dd>
        {result.breakdown.currentStreakYears} Jahr{result.breakdown.currentStreakYears === 1
          ? ''
          : 'e'}
      </dd>

      <dt>Drohender BRE-Verlust</dt>
      <dd>{formatEur(result.breakdown.projectedBRELoss)}</dd>

      <dt>Barwert BRE-Verlust (NPV)</dt>
      <dd>{formatEur(result.breakdown.lostBREValue_NPV)}</dd>

      <dt>Restliche Monate bis Jahresende</dt>
      <dd>{result.breakdown.monthsToYearEnd}</dd>

      <dt>Diskontrate</dt>
      <dd>{(result.breakdown.discountRate * 100).toFixed(1)} %</dd>

      {#if result.breakdown.taxSavingFromSelfPay > 0}
        <dt>Steuerersparnis (§33 EStG)</dt>
        <dd>{formatEur(result.breakdown.taxSavingFromSelfPay)}</dd>
      {/if}
    </dl>
  </details>

  {#if onSubmit || onSelfPay}
    <div class="gcp-actions">
      {#if onSubmit}
        <button type="button" class="btn-submit" onclick={onSubmit} disabled={loading}>
          {isSubmit ? 'Einreichen' : 'Trotzdem einreichen'}
        </button>
      {/if}
      {#if onSelfPay}
        <button type="button" class="btn-self-pay" onclick={onSelfPay} disabled={loading}>
          {!isSubmit ? 'Selbst zahlen' : 'Selbst zahlen'}
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .gcp-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    border-radius: var(--radius-md);
    border: 2px solid var(--color-border);
    background: var(--color-surface);
  }

  .gcp-card.submit {
    border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 4%, var(--color-surface));
  }

  .gcp-card.self-pay {
    border-color: color-mix(in srgb, var(--color-warning) 60%, var(--color-border));
    background: color-mix(in srgb, var(--color-warning) 4%, var(--color-surface));
  }

  .gcp-header {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
  }

  .gcp-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 50%;
    font-size: 1.25rem;
    flex-shrink: 0;
  }

  .submit .gcp-icon {
    background: var(--color-primary-soft);
    color: var(--color-primary-strong);
  }

  .self-pay .gcp-icon {
    background: color-mix(in srgb, var(--color-warning) 16%, var(--color-surface));
    color: var(--color-warning);
  }

  .gcp-recommendation {
    font-size: var(--font-size-lg);
    display: block;
  }

  .submit .gcp-recommendation {
    color: var(--color-primary-strong);
  }

  .self-pay .gcp-recommendation {
    color: var(--color-warning);
  }

  .gcp-net {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    margin-top: var(--space-1);
  }

  .gcp-net strong {
    color: var(--color-text);
  }

  .gcp-explanation {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    line-height: 1.6;
  }

  .gcp-breakdown {
    font-size: var(--font-size-sm);
  }

  .gcp-breakdown summary {
    cursor: pointer;
    color: var(--color-text-muted);
    user-select: none;
  }

  .gcp-breakdown summary:hover {
    color: var(--color-primary);
  }

  .breakdown-grid {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--space-1) var(--space-4);
    margin: var(--space-2) 0 0;
    padding: var(--space-3);
    background: var(--color-bg);
    border-radius: var(--radius-sm);
  }

  .breakdown-grid dt {
    color: var(--color-text-muted);
  }

  .breakdown-grid dd {
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-weight: 500;
    margin: 0;
  }

  .gcp-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .btn-submit,
  .btn-self-pay {
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-sm);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
  }

  .btn-submit {
    background: var(--color-primary);
    color: var(--color-primary-contrast);
  }

  .btn-submit:hover:not(:disabled) {
    background: var(--color-primary-strong);
  }

  .btn-self-pay {
    background: var(--color-surface);
    border-color: var(--color-border);
    color: var(--color-text);
  }

  .btn-self-pay:hover:not(:disabled) {
    background: var(--color-bg);
  }

  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
