<script lang="ts">
  import { LinkPreview as HoverCardPrimitive } from 'bits-ui';
  import type { ComponentProps } from 'svelte';
  import HoverCardPortal from './hover-card-portal.svelte';
  import { cn } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    sideOffset = 4,
    align = 'center',
    portalProps,
    ...restProps
  }: HoverCardPrimitive.ContentProps & {
    portalProps?: ComponentProps<typeof HoverCardPortal>;
  } = $props();
</script>

<HoverCardPortal {...portalProps}>
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
</HoverCardPortal>
