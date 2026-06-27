<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  import AppShell from '$lib/components/AppShell.svelte';
  import '$lib/styles/app.css';

  let { children }: { children: Snippet } = $props();
</script>

<AppShell>
  {@render children()}
</AppShell>
