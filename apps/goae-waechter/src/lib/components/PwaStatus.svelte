<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  PWA status surface: a small inline banner for the update-reload hint and the
  offline-ready confirmation. Unlike apps/frontend's toast-based PwaStatus, this
  demo has no offline write-queue/online-status to surface (issue #170), so a
  plain Alert banner is enough.
-->
<script lang="ts">
  import { initPwa } from '$lib/pwa/register.js';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';
  import { Button } from '$lib/components/ui/button';

  const { needRefresh, offlineReady, updateServiceWorker } = initPwa();
</script>

{#if $needRefresh}
  <Alert>
    <AlertDescription class="flex flex-wrap items-center justify-between gap-2">
      <span>Eine neue Version ist verfügbar.</span>
      <Button size="sm" onclick={() => updateServiceWorker(true)}>Neu laden</Button>
    </AlertDescription>
  </Alert>
{:else if $offlineReady}
  <Alert>
    <AlertDescription>App ist offline einsatzbereit.</AlertDescription>
  </Alert>
{/if}
