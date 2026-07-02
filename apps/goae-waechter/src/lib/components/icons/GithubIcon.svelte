<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  The official GitHub mark (octocat). Not part of @lucide/svelte (Lucide
  intentionally ships no brand/wordmark icons), so it is vendored here as a
  plain inline SVG — same path data GitHub itself uses for the mark, kept
  same-origin per the project's no-third-party-CDN rule.
-->
<script lang="ts">
  import type { SVGAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils.js';

  let { class: className, ...restProps }: SVGAttributes<SVGSVGElement> = $props();
</script>

<svg
  viewBox="0 0 24 24"
  fill="currentColor"
  aria-hidden="true"
  class={cn('size-4', className)}
  {...restProps}
>
  <path
    d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.386-1.333-1.755-1.333-1.755-1.089-.744.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.108-.775.42-1.304.762-1.604-2.665-.303-5.467-1.332-5.467-5.93 0-1.31.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23a11.5 11.5 0 0 1 3.003-.404c1.018.005 2.045.138 3.003.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.61-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.015 2.898-.015 3.293 0 .319.216.694.825.576C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
  />
</svg>
