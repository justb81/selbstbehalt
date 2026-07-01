<script lang="ts">
  import { AlertDialog } from 'bits-ui';
  import { cn } from '$lib/utils.js';

  let { ref = $bindable(null), class: className, ...restProps }: AlertDialog.TitleProps = $props();
</script>

<AlertDialog.Title
  bind:ref
  data-slot="alert-dialog-title"
  class={cn('text-lg leading-none font-semibold', className)}
  {...restProps}
/>
