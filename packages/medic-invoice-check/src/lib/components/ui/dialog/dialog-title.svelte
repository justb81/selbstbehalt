<script lang="ts">
  import { Dialog } from 'bits-ui';
  import { cn } from '../../../utils.js';

  let { ref = $bindable(null), class: className, ...restProps }: Dialog.TitleProps = $props();
</script>

<Dialog.Title
  bind:ref
  data-slot="dialog-title"
  class={cn('text-lg leading-none font-semibold', className)}
  {...restProps}
/>
