<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  const title = 'Rechnung scannen';
</script>

<svelte:head><title>{title} · selbstbehalt</title></svelte:head>

<section>
  <h1>{title}</h1>
  <p>
    Bildaufnahme und client-seitige OCR (Kamera/Datei-Upload, Web-Worker) sind vorbereitet; der
    geführte Scan-Flow folgt mit #26. Rechnungsbilder verlassen das Gerät nie.
  </p>
</section>
