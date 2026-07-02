<script lang="ts">
  import { Dialog } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import type { ComponentProps } from 'svelte';
  import DialogOverlay from './dialog-overlay.svelte';
  import DialogPortal from './dialog-portal.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import XIcon from '@lucide/svelte/icons/x';
  import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    portalProps,
    children,
    ...restProps
  }: WithoutChildrenOrChild<Dialog.ContentProps> & {
    portalProps?: ComponentProps<typeof DialogPortal>;
    children: Snippet;
  } = $props();
</script>

<DialogPortal {...portalProps}>
  <DialogOverlay />
  <Dialog.Content
    bind:ref
    data-slot="dialog-content"
    class={cn(
      'bg-background fixed top-[50%] left-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-open:slide-in-from-left-1/2 data-open:slide-in-from-top-[48%] data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-closed:slide-out-to-left-1/2 data-closed:slide-out-to-top-[48%]',
      className,
    )}
    {...restProps}
  >
    {@render children()}
    <Dialog.Close data-slot="dialog-close">
      {#snippet child({ props })}
        <Button
          variant="ghost"
          size="icon"
          class="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
          {...props}
        >
          <XIcon class="size-4" />
          <span class="sr-only">Schließen</span>
        </Button>
      {/snippet}
    </Dialog.Close>
  </Dialog.Content>
</DialogPortal>
