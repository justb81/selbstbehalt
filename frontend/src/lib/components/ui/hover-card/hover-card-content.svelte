<script lang="ts">
  import { LinkPreview as HoverCardPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    sideOffset = 4,
    align = 'center',
    ...restProps
  }: HoverCardPrimitive.ContentProps = $props();
</script>

<HoverCardPrimitive.Content
  bind:ref
  data-slot="hover-card-content"
  {sideOffset}
  {align}
  class={cn(
    'bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 z-50 w-64 rounded-lg border p-3 shadow-md outline-none',
    className,
  )}
  {...restProps}
/>
