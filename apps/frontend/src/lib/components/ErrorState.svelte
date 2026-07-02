<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Reusable error panel with an optional retry action. -->
<script lang="ts">
  import { Alert, AlertTitle, AlertDescription } from '$lib/components/ui/alert';
  import { Button } from '$lib/components/ui/button';

  let {
    title = 'Etwas ist schiefgelaufen',
    message = 'Bitte versuche es später erneut.',
    onRetry,
  }: { title?: string; message?: string; onRetry?: () => void } = $props();
</script>

<Alert variant="destructive">
  <AlertTitle>{title}</AlertTitle>
  <AlertDescription>{message}</AlertDescription>
  {#if onRetry}
    <div class="mt-3">
      <Button variant="outline" size="sm" onclick={onRetry}>Erneut versuchen</Button>
    </div>
  {/if}
</Alert>
