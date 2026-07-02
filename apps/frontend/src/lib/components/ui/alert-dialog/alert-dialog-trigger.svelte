<script lang="ts">
  import { AlertDialog } from 'bits-ui';

  let { ref = $bindable(null), ...restProps }: AlertDialog.TriggerProps = $props();
</script>

<AlertDialog.Trigger bind:ref data-slot="alert-dialog-trigger" {...restProps} />
