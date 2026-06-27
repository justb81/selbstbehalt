<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { resolveApiBaseUrl } from '$lib/stores/settings';
</script>

<svelte:head><title>Einstellungen · selbstbehalt</title></svelte:head>

<section>
  <h1>Einstellungen</h1>
  <p>
    Server-URL, Steuersatz, Diskontrate und Datenbankexport folgen mit #20. Aktuell verwendete
    Server-URL: <code>{resolveApiBaseUrl()}</code>.
  </p>
</section>
