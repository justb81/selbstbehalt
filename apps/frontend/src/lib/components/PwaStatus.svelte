<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  PWA status surface (issue #27): shows the update reload hint, offline-ready
  confirmation, and offline / pending-writes status as toasts instead of inline
  banners that were hidden behind the fixed app header.
-->
<script lang="ts">
  import { toast } from 'svelte-sonner';
  import { isOnline, pendingWrites } from '$lib/offline/index.js';
  import { initPwa } from '$lib/pwa/register.js';

  const { needRefresh, offlineReady, updateServiceWorker } = initPwa();

  $effect(() => {
    if ($needRefresh) {
      toast('Eine neue Version ist verfügbar.', {
        id: 'pwa-update',
        duration: Infinity,
        action: { label: 'Neu laden', onClick: () => updateServiceWorker(true) },
        cancel: { label: 'Später', onClick: () => needRefresh.set(false) },
      });
    } else {
      toast.dismiss('pwa-update');
    }
  });

  $effect(() => {
    if ($offlineReady) {
      toast.success('App ist offline einsatzbereit.');
    }
  });

  $effect(() => {
    if (!$isOnline) {
      toast.warning('Offline – Änderungen werden gespeichert.', {
        id: 'offline-status',
        duration: Infinity,
        description: $pendingWrites > 0 ? `${$pendingWrites} ausstehend` : undefined,
      });
    } else {
      toast.dismiss('offline-status');
    }
  });

  $effect(() => {
    if ($isOnline && $pendingWrites > 0) {
      toast(`${$pendingWrites} Änderung(en) werden synchronisiert …`, {
        id: 'pending-sync',
        duration: Infinity,
      });
    } else {
      toast.dismiss('pending-sync');
    }
  });
</script>
