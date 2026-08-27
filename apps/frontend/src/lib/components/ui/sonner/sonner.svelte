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
  this goes back to `mode.current` and --error-text/--warning-text need a dark
  counterpart.

  --error-text / --warning-text override sonner's rich colors, which ship at
  4.38:1 and 4.4:1 on their own light backgrounds — just under the WCAG AA 4.5:1
  this repo enforces via e2e/a11y.spec.ts.
-->
<Sonner
  theme="light"
  class="toaster group"
  style="--normal-bg: var(--color-popover); --normal-text: var(--color-popover-foreground); --normal-border: var(--color-border); --error-text: #991b1b; --warning-text: #92400e;"
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
