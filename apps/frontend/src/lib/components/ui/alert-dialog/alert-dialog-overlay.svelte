<script lang="ts">
  import { AlertDialog } from 'bits-ui';
  import { cn } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: AlertDialog.OverlayProps = $props();
</script>

<AlertDialog.Overlay
  bind:ref
  data-slot="alert-dialog-overlay"
  class={cn(
    'fixed inset-0 z-50 bg-black/50 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
    className,
  )}
  {...restProps}
/>
