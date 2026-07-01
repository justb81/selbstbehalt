<script lang="ts">
  import { LinkPreview as HoverCardPrimitive } from 'bits-ui';
  let { ...restProps }: HoverCardPrimitive.RootProps = $props();
</script>

<HoverCardPrimitive.Root {...restProps} />
