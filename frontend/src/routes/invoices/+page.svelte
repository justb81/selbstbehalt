<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { resolve } from '$app/paths';

  const title = 'Rechnungen';
</script>

<svelte:head><title>{title} · selbstbehalt</title></svelte:head>

<section>
  <h1>{title}</h1>
  <p>Das Rechnungsarchiv (Filter, Suche) folgt mit #22.</p>
  <p><a href={resolve('/invoices/scan')}>Rechnung scannen</a></p>
</section>
