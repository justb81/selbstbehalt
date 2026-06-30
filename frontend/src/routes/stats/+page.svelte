<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Jahresauswertung (docs/design.md §6.1, issue #28):
  Vollständige Jahresanalyse — Kosten, Erstattungen, BRE-Jahresverlauf, Export.
  Das Dashboard zeigt offene Aktionen und BRE-Schnellstatus; diese Seite liefert
  die detaillierte Jahresanalyse.
-->
<script lang="ts">
  import { resolve } from '$app/paths';
</script>

<svelte:head><title>Auswertung · selbstbehalt</title></svelte:head>

<div class="container mx-auto max-w-5xl px-4 py-8 space-y-6">
  <div class="space-y-1">
    <h1 class="text-2xl font-bold tracking-tight">Auswertung</h1>
    <p class="text-sm text-muted-foreground">
      Jahresanalyse: Kosten, Erstattungen und BRE-Jahresverlauf.
    </p>
  </div>

  <div
    class="rounded-lg border border-border bg-muted/30 px-6 py-8 text-center text-muted-foreground space-y-2"
  >
    <p class="font-medium text-foreground">Vollständige Jahresauswertung folgt</p>
    <p class="text-sm">
      Die detaillierte Jahresanalyse (Kosten, Erstattungen, BRE-Jahresverlauf, Export) ist für einen
      späteren Release geplant.
    </p>
    <p class="text-sm">
      Aktuelle Übersicht: <a href={resolve('/')} class="underline hover:text-primary">Dashboard</a>
      · Günstigerprüfung je Person:
      <a href={resolve('/insured')} class="underline hover:text-primary">Versicherte</a>
    </p>
  </div>
</div>
