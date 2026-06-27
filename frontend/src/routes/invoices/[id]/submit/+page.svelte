<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { page } from '$app/state';
</script>

<svelte:head><title>Einreichung · selbstbehalt</title></svelte:head>

<section>
  <h1>Einreichung</h1>
  <p>Das Einreichungsformular für Rechnung <code>{page.params.id}</code> folgt mit #22.</p>
</section>
