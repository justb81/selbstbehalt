<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Reusable inline loading indicator for async data sections. -->
<script lang="ts">
  let { label = 'Wird geladen …' }: { label?: string } = $props();
</script>

<div class="loading" role="status" aria-live="polite">
  <span class="spinner" aria-hidden="true"></span>
  <span>{label}</span>
</div>

<style>
  .loading {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-muted);
  }

  .spinner {
    width: 1.1em;
    height: 1.1em;
    border: 2px solid var(--color-border);
    border-top-color: var(--color-primary);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
    }
  }
</style>
