<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { page } from '$app/state';

  import ErrorState from '$lib/components/ErrorState.svelte';
</script>

<svelte:head>
  <title>Fehler {page.status} · selbstbehalt</title>
</svelte:head>

<ErrorState
  title={`Fehler ${page.status}`}
  message={page.error?.message ?? 'Die Seite konnte nicht geladen werden.'}
/>
