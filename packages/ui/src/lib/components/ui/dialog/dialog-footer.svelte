<script lang="ts">
  import { cn } from '../../../utils.js';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    class: className,
    children,
    ...restProps
  }: HTMLAttributes<HTMLDivElement> & { children?: Snippet } = $props();
</script>

<div
  data-slot="dialog-footer"
  class={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
  {...restProps}
>
  {@render children?.()}
</div>
