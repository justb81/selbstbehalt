<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  PersonStatusCard (issue #261): the dashboard's single per-person status card.
  The dashboard used to render two cards for the same person — a compact
  SelbstbehaltRadar and a compact BRETracker, back to back, both linking to the
  same /insured/[id] — which doubled the scroll distance and repeated the name.
  This composes them into one: the radar's compact header (label + Ampel badge)
  and thermometer, then the BRE streak/progress row underneath. Both underlying
  components keep their own standalone `compact` card for other pages (contracts
  detail, insured list) — this component only serves the dashboard merge.
-->
<script lang="ts">
  import type { InsuredPerson } from '@selbstbehalt/shared';
  import type { SBRadar } from '$lib/utils/selbstbehalt-radar';
  import SelbstbehaltRadar from './SelbstbehaltRadar.svelte';
  import BRETracker from './BRETracker.svelte';
  import { Separator } from '$lib/components/ui/separator';

  let {
    insuredPerson,
    radar,
    href,
  }: {
    insuredPerson: InsuredPerson;
    radar: SBRadar;
    href: string;
  } = $props();

  const label = $derived(insuredPerson.tariff_name ?? insuredPerson.kvnr ?? 'Versicherte Person');

  // Kept as a const so the link stays on one line — the eslint-disable for the
  // pre-resolved href must sit directly above the <a>.
  const cardClass =
    'group border-border bg-card text-card-foreground hover:border-primary focus-visible:ring-ring flex flex-col gap-2 rounded-xl border px-3 py-2.5 no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2';
</script>

<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- href is pre-resolved by caller -->
<a {href} class={cardClass}>
  <SelbstbehaltRadar {radar} {label} bare chevron />
  <Separator />
  <BRETracker {insuredPerson} bare />
</a>
