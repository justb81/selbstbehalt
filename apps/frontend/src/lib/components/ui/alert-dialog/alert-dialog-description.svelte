<script lang="ts">
  import { AlertDialog } from 'bits-ui';
  import { cn } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: AlertDialog.DescriptionProps = $props();
</script>

<AlertDialog.Description
  bind:ref
  data-slot="alert-dialog-description"
  class={cn('text-muted-foreground text-sm', className)}
  {...restProps}
/>
