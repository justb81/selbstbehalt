<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Reusable error panel with an optional retry action.

  Two severities, because they mean different things (#463): `error` is a total
  failure — the section has nothing to show — and gets the red `destructive`
  Alert. `warning` is a *partial* load: the rest of the page is real data, only a
  sub-request is missing. That used to wear the same red alert as an outage,
  which read as "everything here is broken".
-->
<script lang="ts">
  import { Alert, AlertTitle, AlertDescription } from '@selbstbehalt/ui/alert';
  import { Button } from '@selbstbehalt/ui/button';

  let {
    variant = 'error',
    title,
    message = 'Bitte versuche es später erneut.',
    onRetry,
  }: {
    variant?: 'error' | 'warning';
    title?: string;
    message?: string;
    onRetry?: () => void;
  } = $props();

  const heading = $derived(
    title ?? (variant === 'warning' ? 'Teilweise geladen' : 'Etwas ist schiefgelaufen'),
  );
</script>

<Alert
  variant={variant === 'warning' ? 'default' : 'destructive'}
  class={variant === 'warning' ? 'border-warning/60 text-warning' : undefined}
>
  <AlertTitle>{heading}</AlertTitle>
  <!-- Voller `text-warning`, kein `/90`: die 90 % blenden gegen die Kartenfläche
       auf 4,44:1 herunter und reißen damit WCAG AA (axe `color-contrast`). -->
  <AlertDescription class={variant === 'warning' ? 'text-warning' : undefined}>
    {message}
  </AlertDescription>
  {#if onRetry}
    <div class="mt-3">
      <Button variant="outline" size="sm" onclick={onRetry}>Erneut versuchen</Button>
    </div>
  {/if}
</Alert>
