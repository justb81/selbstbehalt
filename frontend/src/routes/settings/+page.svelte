<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { resolveApiBaseUrl, settings } from '$lib/stores/settings';

  // Derived from the store so the displayed URL stays in sync once the settings
  // form (#20) lets the user change it within the same session.
  const apiBaseUrl = $derived(resolveApiBaseUrl($settings));
</script>

<svelte:head><title>Einstellungen · selbstbehalt</title></svelte:head>

<section>
  <h1>Einstellungen</h1>
  <p>
    Server-URL, Steuersatz, Diskontrate und Datenbankexport folgen mit #20. Aktuell verwendete
    Server-URL: <code>{apiBaseUrl}</code>.
  </p>
</section>
