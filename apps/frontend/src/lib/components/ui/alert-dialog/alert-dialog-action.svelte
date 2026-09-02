<script lang="ts">
  import { AlertDialog } from 'bits-ui';
  import { buttonVariants, type ButtonSize, type ButtonVariant } from '@selbstbehalt/ui/button';
  import { cn } from '@selbstbehalt/ui/utils';

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
