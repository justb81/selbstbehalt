<script lang="ts">
  import { cn } from '$lib/utils.js';
  import type { HTMLAttributes } from 'svelte/elements';

  let { class: className, ...restProps }: HTMLAttributes<HTMLDivElement> = $props();
</script>

<div
  data-slot="dialog-header"
  class={cn('flex flex-col gap-1.5 text-center sm:text-left', className)}
  {...restProps}
></div>
