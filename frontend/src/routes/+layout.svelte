<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { onMount, type Snippet } from 'svelte';

  import { offlineReplayRequester, offlineQueue } from '$lib/api/index.js';
  import AppShell from '$lib/components/AppShell.svelte';
  import { initOfflineSync } from '$lib/offline/index.js';
  import '../app.css';

  let { children }: { children: Snippet } = $props();

  // Wire connectivity + offline write-queue replay once the app is mounted
  // (issue #27). Replay uses the RAW requester (not the offline-wrapped one) so a
  // replay that fails offline can't re-enqueue a duplicate. The service worker is
  // registered separately by PwaStatus → initPwa.
  onMount(() => initOfflineSync(offlineReplayRequester, offlineQueue));
</script>

<AppShell>
  {@render children()}
</AppShell>
