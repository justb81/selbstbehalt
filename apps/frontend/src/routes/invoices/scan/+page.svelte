<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Scan flow is now part of /invoices/new (issue #109). -->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  onMount(() => void goto(resolve('/invoices/new'), { replaceState: true }));
</script>
