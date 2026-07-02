<script lang="ts">
  import { Select as SelectPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    placeholder,
    ...restProps
  }: SelectPrimitive.ValueProps & { class?: string } = $props();
</script>

<SelectPrimitive.Value
  bind:ref
  data-slot="select-value"
  {placeholder}
  class={cn(className)}
  {...restProps}
/>
