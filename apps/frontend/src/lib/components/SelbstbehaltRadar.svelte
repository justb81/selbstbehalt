<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  SelbstbehaltRadar (docs/design.md §5.2, issue #234): a forward-looking Ampel for
  the current Leistungsjahr — a thermometer filled to R_Y with two markers (the
  Selbstbehalt line S and the Einreich-Schwelle S + NPV) plus a traffic-light badge
  and plain-text hint. The parent computes the radar via `computeSelbstbehaltRadar`
  (owning data fetching, settings and `asOf`); this component only renders it.

  `compact` renders a slim variant for the dashboard / insured detail; an optional
  `href` turns the compact card into a link to the full Günstigerprüfung verdict.
-->
<script lang="ts">
  import { formatEur } from '@selbstbehalt/shared';
  import type { SBRadar, SBRadarState } from '$lib/utils/selbstbehalt-radar';
  import { cn } from '$lib/utils';
  import { Badge } from '$lib/components/ui/badge';
  import { Card, CardContent, CardHeader } from '$lib/components/ui/card';

  let {
    radar,
    label = undefined,
    compact = false,
    href = undefined,
  }: {
    radar: SBRadar;
    /** Optional heading (e.g. the insured person's name/tariff). */
    label?: string;
    compact?: boolean;
    /**
     * Link to the full Günstigerprüfung verdict. When compact, wraps the whole card
     * in the link; in the full variant it renders as a footer link.
     */
    href?: string;
  } = $props();

  // Ampel copy + colours, harmonised with GCPCard / BRETracker (muted = neutral,
  // amber = caution, emerald = go).
  const STATE_LABEL: Record<SBRadarState, string> = {
    unter_sb: 'Unter Selbstbehalt',
    sb_erreicht_unter_schwelle: 'SB erreicht',
    ueber_schwelle: 'Einreichen lohnt',
    bereits_gebrochen: 'Staffel gerissen',
  };
  const STATE_BADGE: Record<SBRadarState, string> = {
    unter_sb: 'border-border text-muted-foreground',
    sb_erreicht_unter_schwelle: 'border-amber-500/60 text-amber-700 dark:text-amber-400',
    ueber_schwelle: 'border-emerald-500/60 text-emerald-700 dark:text-emerald-400',
    bereits_gebrochen: 'border-emerald-500/60 text-emerald-700 dark:text-emerald-400',
  };
  const STATE_FILL: Record<SBRadarState, string> = {
    unter_sb: 'bg-muted-foreground/40',
    sb_erreicht_unter_schwelle: 'bg-amber-500',
    ueber_schwelle: 'bg-emerald-500',
    bereits_gebrochen: 'bg-emerald-500',
  };

  const restBisSB = $derived(Math.max(0, radar.selbstbehalt - radar.R_Y));
  const exhaustionPct = $derived(Math.round(radar.sbExhaustion * 100));
  const statusText = $derived.by(() => {
    switch (radar.state) {
      case 'unter_sb':
        return `Noch ${formatEur(restBisSB)} bis zum Selbstbehalt — Einreichen bleibt folgenlos.`;
      case 'sb_erreicht_unter_schwelle':
        return `Noch ${formatEur(radar.restBisEinreichen)} bis Einreichen lohnt.`;
      case 'ueber_schwelle':
        return `Schwelle überschritten — alle ${radar.year}er einreichen.`;
      case 'bereits_gebrochen':
        return `Staffel gerissen — alle ${radar.year}er einreichen.`;
    }
  });

  // Thermometer geometry — scale to the largest of R_Y / threshold / S plus a little
  // headroom so both markers and the fill stay visible even in the over-threshold case.
  const barMax = $derived(Math.max(radar.gcpThreshold, radar.R_Y, radar.selbstbehalt, 1) * 1.08);
  const fillPct = $derived(Math.min(100, Math.max(0, (radar.R_Y / barMax) * 100)));
  const sbPct = $derived(Math.min(100, (radar.selbstbehalt / barMax) * 100));
  const thresholdPct = $derived(Math.min(100, (radar.gcpThreshold / barMax) * 100));
  // Only distinct once a BRE loss lifts the threshold above S (npvThreshold > 0).
  const showThresholdMarker = $derived(radar.gcpThreshold > radar.selbstbehalt);

  // Compact card classes kept as consts so the link stays on one line — the
  // eslint-disable for the pre-resolved href must sit directly above the <a>.
  const compactCardClass =
    'border-border bg-card text-card-foreground flex flex-col gap-1.5 rounded-xl border px-3 py-2';
  const compactLinkClass = cn(
    compactCardClass,
    'hover:border-primary no-underline transition-colors',
  );
</script>

{#snippet thermometer(trackHeight: string)}
  <div
    class={cn('bg-muted relative w-full overflow-hidden rounded-full', trackHeight)}
    role="progressbar"
    aria-label={`Selbstbehalt-Ausschöpfung ${radar.year}`}
    aria-valuenow={exhaustionPct}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuetext={`${formatEur(radar.R_Y)} von ${formatEur(radar.selbstbehalt)} Selbstbehalt`}
  >
    <div
      class={cn('absolute inset-y-0 left-0 rounded-full transition-all', STATE_FILL[radar.state])}
      style="width: {fillPct}%"
    ></div>
    <!-- Selbstbehalt marker -->
    <div
      class="bg-foreground/70 absolute inset-y-0 w-0.5"
      style="left: {sbPct}%"
      aria-hidden="true"
    ></div>
    {#if showThresholdMarker}
      <!-- Einreich-Schwelle marker (S + NPV) -->
      <div
        class="border-primary absolute inset-y-0 border-l-2 border-dashed"
        style="left: {thresholdPct}%"
        aria-hidden="true"
      ></div>
    {/if}
  </div>
{/snippet}

{#snippet legendDot(dotClass: string, text: string)}
  <span class="text-muted-foreground inline-flex items-center gap-1.5">
    <span class={cn('inline-block h-2 w-2 shrink-0 rounded-full', dotClass)} aria-hidden="true"
    ></span>
    {text}
  </span>
{/snippet}

{#if compact}
  {#snippet compactInner()}
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="text-foreground text-sm font-semibold">
        {label ?? `Selbstbehalt ${radar.year}`}
      </span>
      <Badge variant="outline" class={STATE_BADGE[radar.state]}>{STATE_LABEL[radar.state]}</Badge>
    </div>
    {@render thermometer('h-2')}
    <span class="text-muted-foreground text-xs">{statusText}</span>
  {/snippet}

  {#if href}
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- href is pre-resolved by caller -->
    <a {href} class={compactLinkClass}>
      {@render compactInner()}
    </a>
  {:else}
    <div class={compactCardClass}>
      {@render compactInner()}
    </div>
  {/if}
{:else}
  <Card>
    <CardHeader>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-col">
          {#if label}
            <span class="text-foreground text-base font-semibold">{label}</span>
          {/if}
          <span class="text-muted-foreground text-sm">Leistungsjahr {radar.year}</span>
        </div>
        <Badge variant="outline" class={STATE_BADGE[radar.state]}>{STATE_LABEL[radar.state]}</Badge>
      </div>
    </CardHeader>
    <CardContent class="flex flex-col gap-3">
      {@render thermometer('h-3')}

      <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {@render legendDot(STATE_FILL[radar.state], `Erstattungsfähig: ${formatEur(radar.R_Y)}`)}
        {@render legendDot('bg-foreground/70', `Selbstbehalt: ${formatEur(radar.selbstbehalt)}`)}
        {#if showThresholdMarker}
          {@render legendDot('bg-primary', `Einreich-Schwelle: ${formatEur(radar.gcpThreshold)}`)}
        {/if}
        <span class="text-muted-foreground ml-auto tabular-nums">
          {exhaustionPct} % ausgeschöpft
        </span>
      </div>

      <p class="text-muted-foreground text-sm leading-relaxed">{statusText}</p>

      {#if href}
        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- href is pre-resolved by caller -->
        <a {href} class="text-primary text-sm font-medium hover:underline">Zum vollen Verdikt →</a>
      {/if}
    </CardContent>
  </Card>
{/if}
