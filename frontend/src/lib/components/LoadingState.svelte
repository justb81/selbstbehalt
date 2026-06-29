<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Reusable inline loading indicator for async data sections. -->
<script lang="ts">
  let { label = 'Wird geladen …' }: { label?: string } = $props();
</script>

<div class="flex items-center gap-2 text-muted-foreground" role="status" aria-live="polite">
  <span
    class="size-[1.1em] shrink-0 rounded-full border-2 border-border border-t-primary motion-safe:animate-spin"
    aria-hidden="true"
  ></span>
  <span>{label}</span>
</div>
