<script lang="ts">
  import { AlertDialog } from 'bits-ui';
  import {
    buttonVariants,
    type ButtonSize,
    type ButtonVariant,
  } from '$lib/components/ui/button/index.js';
  import { cn } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    variant = 'default',
    size = 'default',
    ...restProps
  }: AlertDialog.ActionProps & { variant?: ButtonVariant; size?: ButtonSize } = $props();
</script>

<AlertDialog.Action
  bind:ref
  data-slot="alert-dialog-action"
  class={cn(buttonVariants({ variant, size }), className)}
  {...restProps}
/>
