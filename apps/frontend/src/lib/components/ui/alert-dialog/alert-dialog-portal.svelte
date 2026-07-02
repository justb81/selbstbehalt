<script lang="ts">
  import { AlertDialog } from 'bits-ui';
  import type { ComponentProps } from 'svelte';

  let { ...restProps }: ComponentProps<typeof AlertDialog.Portal> = $props();
</script>

<AlertDialog.Portal {...restProps} />
