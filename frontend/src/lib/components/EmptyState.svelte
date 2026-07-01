<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Reusable "no data" panel; pairs with LoadingState/ErrorState for a single feedback pattern. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    message,
    action,
    compact = false,
  }: { message: string; action?: Snippet; compact?: boolean } = $props();
</script>

<div
  class={[
    'flex flex-col items-center justify-center text-center gap-2',
    compact ? 'py-6' : 'py-16 gap-4',
  ].join(' ')}
  role="status"
>
  <p class="text-muted-foreground">{message}</p>
  {#if action}{@render action()}{/if}
</div>
