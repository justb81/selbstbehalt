<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { formatEur } from './lib/utils/money';

  let { selbstbehalt = 0 }: { selbstbehalt?: number } = $props();
</script>

<main>
  <h1>selbstbehalt</h1>
  <p>PKV Manager — Grundgerüst steht. Restlicher Selbstbehalt: {formatEur(selbstbehalt)}</p>
</main>
