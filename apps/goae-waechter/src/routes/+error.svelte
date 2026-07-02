<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { page } from '$app/state';
</script>

<svelte:head>
  <title>Fehler {page.status} · GOÄ-Wächter</title>
</svelte:head>

<div class="flex flex-col items-center gap-2 py-16 text-center">
  <h1 class="text-2xl font-bold tracking-tight">Fehler {page.status}</h1>
  <p class="text-muted-foreground">
    {page.error?.message ?? 'Die Seite konnte nicht geladen werden.'}
  </p>
</div>
