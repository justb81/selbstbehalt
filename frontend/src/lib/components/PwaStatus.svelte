<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  PWA status surface (issue #27): the update reload hint, the "offline ready"
  confirmation, and a live offline / pending-writes indicator. Rendered once in
  the app shell; each banner only appears when its condition holds.
-->
<script lang="ts">
  import { isOnline, pendingWrites } from '$lib/offline/index.js';
  import { initPwa } from '$lib/pwa/register.js';

  const { needRefresh, offlineReady, updateServiceWorker } = initPwa();
</script>

{#if $needRefresh}
  <div class="pwa-banner pwa-banner--update" role="alert">
    <span>Eine neue Version ist verfügbar.</span>
    <button type="button" onclick={() => updateServiceWorker(true)}>Neu laden</button>
    <button type="button" class="pwa-dismiss" onclick={() => needRefresh.set(false)}>
      Später
    </button>
  </div>
{:else if $offlineReady}
  <div class="pwa-banner pwa-banner--ready" role="status">
    <span>App ist offline einsatzbereit.</span>
    <button type="button" class="pwa-dismiss" onclick={() => offlineReady.set(false)}>OK</button>
  </div>
{/if}

{#if !$isOnline}
  <div class="pwa-banner pwa-banner--offline" role="status">
    <span>Offline – Änderungen werden gespeichert.</span>
    {#if $pendingWrites > 0}
      <span class="pwa-count">{$pendingWrites} ausstehend</span>
    {/if}
  </div>
{:else if $pendingWrites > 0}
  <div class="pwa-banner pwa-banner--syncing" role="status">
    <span>{$pendingWrites} Änderung(en) werden synchronisiert …</span>
  </div>
{/if}

<style>
  .pwa-banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    font-size: var(--font-size-sm);
  }

  .pwa-banner button {
    cursor: pointer;
    border: 1px solid currentColor;
    border-radius: var(--radius-sm);
    background: transparent;
    padding: var(--space-1) var(--space-3);
    font: inherit;
    color: inherit;
  }

  .pwa-banner .pwa-dismiss {
    border-color: transparent;
    text-decoration: underline;
  }

  .pwa-banner--update {
    background: var(--color-primary-soft);
    color: var(--color-primary-strong);
  }

  .pwa-banner--ready,
  .pwa-banner--syncing {
    background: var(--color-surface);
    color: var(--color-text-muted);
    border-bottom: 1px solid var(--color-border);
  }

  .pwa-banner--offline {
    background: #fef3c7;
    color: #92400e;
  }

  .pwa-count {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }
</style>
