<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { onMount, type Snippet } from 'svelte';

  import { api, offlineQueue } from '$lib/api/index.js';
  import AppShell from '$lib/components/AppShell.svelte';
  import { initOfflineSync } from '$lib/offline/index.js';
  import '$lib/styles/app.css';

  let { children }: { children: Snippet } = $props();

  // Wire connectivity + offline write-queue replay once the app is mounted
  // (issue #27). The service worker itself is registered by PwaStatus → initPwa.
  onMount(() => initOfflineSync(api.request, offlineQueue));
</script>

<AppShell>
  {@render children()}
</AppShell>
