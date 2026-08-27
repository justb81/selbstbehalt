<script lang="ts">
  import { Toaster as Sonner, type ToasterProps as SonnerProps } from 'svelte-sonner';
  import Loader2Icon from '@lucide/svelte/icons/loader-2';
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
  import OctagonXIcon from '@lucide/svelte/icons/octagon-x';
  import InfoIcon from '@lucide/svelte/icons/info';
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

  let { ...restProps }: SonnerProps = $props();
</script>

<!--
  theme is pinned to the app's actual theme rather than `mode.current`. Dark mode
  here is class-based (`.dark`, see app.css) and nothing ever sets that class, so
  the app is light-only today — while sonner, given no theme, falls back to
  `prefers-color-scheme` on its own and rendered a dark toast on an otherwise
  light page. That disagreement also drove the rich-color text below onto the
  wrong background. When dark mode lands (a ModeWatcher plus the .dark class),
  this goes back to `mode.current` and app.css needs a
  [data-sonner-theme='dark'] counterpart to the block described below.

  Pinning it also re-activates the AA-tuned rich-color tokens in app.css, whose
  selector is keyed on [data-sonner-theme='light'] (issue #29): with no theme,
  sonner emits data-sonner-theme="system" instead, that block stops matching, and
  the toast falls back to sonner's own 4.38:1 error text — under the WCAG AA
  4.5:1 this repo enforces via e2e/a11y.spec.ts. With the block applying again
  the error text measures 5.8:1, so no colour is overridden here.
-->
<Sonner
  theme="light"
  class="toaster group"
  style="--normal-bg: var(--color-popover); --normal-text: var(--color-popover-foreground); --normal-border: var(--color-border);"
  {...restProps}
>
  {#snippet loadingIcon()}
    <Loader2Icon class="size-4 animate-spin" />
  {/snippet}
  {#snippet successIcon()}
    <CircleCheckIcon class="size-4" />
  {/snippet}
  {#snippet errorIcon()}
    <OctagonXIcon class="size-4" />
  {/snippet}
  {#snippet infoIcon()}
    <InfoIcon class="size-4" />
  {/snippet}
  {#snippet warningIcon()}
    <TriangleAlertIcon class="size-4" />
  {/snippet}
</Sonner>
