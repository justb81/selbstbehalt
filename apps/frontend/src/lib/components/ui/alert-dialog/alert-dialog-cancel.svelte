<script lang="ts">
  import { AlertDialog } from 'bits-ui';
  import { buttonVariants, type ButtonSize, type ButtonVariant } from '@selbstbehalt/ui/button';
  import { cn } from '@selbstbehalt/ui/utils';

  let {
    ref = $bindable(null),
    class: className,
    variant = 'outline',
    size = 'default',
    ...restProps
  }: AlertDialog.CancelProps & { variant?: ButtonVariant; size?: ButtonSize } = $props();
</script>

<AlertDialog.Cancel
  bind:ref
  data-slot="alert-dialog-cancel"
  class={cn(buttonVariants({ variant, size }), className)}
  {...restProps}
/>
