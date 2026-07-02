<script lang="ts">
  import { Dialog } from 'bits-ui';
  import type { ComponentProps } from 'svelte';

  let { ...restProps }: ComponentProps<typeof Dialog.Portal> = $props();
</script>

<Dialog.Portal {...restProps} />
