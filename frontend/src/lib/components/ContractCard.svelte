<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Contract summary card (docs/design.md §6.2, issue #21). -->
<script lang="ts">
  import { resolve } from '$app/paths';
  import { type Contract, type ContractType } from '@selbstbehalt/shared';

  let {
    contract,
    insuredCount = 0,
  }: {
    contract: Contract;
    insuredCount?: number;
  } = $props();

  const TYPE_LABELS: Record<ContractType, string> = {
    vollversicherung: 'Vollversicherung',
    zusatztarif: 'Zusatztarif',
    beihilfe: 'Beihilfe',
  };
</script>

<a href={resolve('/contracts/[id]', { id: contract.id })} class="card">
  <div class="header">
    <strong class="insurer">{contract.insurer_name}</strong>
    <span class="type-badge">{TYPE_LABELS[contract.type]}</span>
  </div>

  {#if contract.contract_number}
    <div class="meta">Nr. {contract.contract_number}</div>
  {/if}

  <div class="footer">
    <span class="persons-count">
      {insuredCount}
      {insuredCount === 1 ? 'versicherte Person' : 'versicherte Personen'}
    </span>
    {#if contract.end_date}
      <span class="date-range">bis {contract.end_date}</span>
    {:else}
      <span class="date-range">seit {contract.start_date}</span>
    {/if}
  </div>
</a>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    text-decoration: none;
    color: inherit;
    transition: box-shadow 0.15s ease;
  }

  .card:hover {
    box-shadow: var(--shadow-md);
    border-color: var(--color-primary);
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .insurer {
    font-size: var(--font-size-lg);
    color: var(--color-text);
  }

  .type-badge {
    padding: 0.15em 0.6em;
    border-radius: 999px;
    font-size: var(--font-size-sm);
    font-weight: 500;
    background: var(--color-primary-soft);
    color: var(--color-primary-strong);
  }

  .meta {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    flex-wrap: wrap;
  }

  .persons-count {
    font-weight: 500;
  }
</style>
