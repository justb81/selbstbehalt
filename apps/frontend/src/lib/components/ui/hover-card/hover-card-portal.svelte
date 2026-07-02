<script lang="ts">
  import { LinkPreview as HoverCardPrimitive } from 'bits-ui';
  import type { ComponentProps } from 'svelte';

  let { ...restProps }: ComponentProps<typeof HoverCardPrimitive.Portal> = $props();
</script>

<HoverCardPrimitive.Portal {...restProps} />
