<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Reusable error panel with an optional retry action. -->
<script lang="ts">
  let {
    title = 'Etwas ist schiefgelaufen',
    message = 'Bitte versuche es später erneut.',
    onRetry,
  }: { title?: string; message?: string; onRetry?: () => void } = $props();
</script>

<div class="error-state" role="alert">
  <h2>{title}</h2>
  <p>{message}</p>
  {#if onRetry}
    <button type="button" onclick={onRetry}>Erneut versuchen</button>
  {/if}
</div>

<style>
  .error-state {
    padding: var(--space-4);
    border: 1px solid color-mix(in srgb, var(--color-danger) 30%, var(--color-border));
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-danger) 6%, var(--color-surface));
  }

  .error-state h2 {
    color: var(--color-danger);
    font-size: var(--font-size-lg);
  }

  button {
    padding: var(--space-2) var(--space-4);
    border: none;
    border-radius: var(--radius-sm);
    background: var(--color-primary);
    color: var(--color-primary-contrast);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
  }

  button:hover {
    background: var(--color-primary-strong);
  }
</style>
