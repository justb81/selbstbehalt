<script lang="ts">
  import { AlertDialog } from 'bits-ui';

  let { open = $bindable(false), ...restProps }: AlertDialog.RootProps = $props();
</script>

<AlertDialog.Root bind:open {...restProps} />
