<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { resolve } from '$app/paths';

  const title = 'Verträge';
</script>

<svelte:head><title>{title} · selbstbehalt</title></svelte:head>

<section>
  <h1>{title}</h1>
  <p>Die Vertragsverwaltung (Liste, BRE-Tracker) folgt mit #21.</p>
  <p><a href={resolve('/contracts/new')}>Neuen Vertrag anlegen</a></p>
</section>
