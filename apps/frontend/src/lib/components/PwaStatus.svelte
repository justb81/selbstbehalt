<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  PWA status surface (issue #27): shows the update reload hint, offline-ready
  confirmation, and offline / pending-writes status as toasts instead of inline
  banners that were hidden behind the fixed app header. Since issue #381 it also
  carries the "server unreachable" notice.
-->
<script lang="ts">
  import { toast } from 'svelte-sonner';
  import { formatDateTime } from '@selbstbehalt/shared';
  import { api, serverStatus } from '$lib/api';
  import { isOnline, pendingWrites } from '$lib/offline/index.js';
  import {
    installAvailable,
    initInstallPrompt,
    promptInstall,
    dismissInstall,
    resetInstallDismissal,
  } from '$lib/pwa/install.js';
  import { initPwa } from '$lib/pwa/register.js';

  const { needRefresh, offlineReady, updateServiceWorker } = initPwa();
  initInstallPrompt();

  $effect(() => {
    if ($installAvailable) {
      toast('App installieren?', {
        id: 'pwa-install',
        duration: Infinity,
        action: { label: 'Installieren', onClick: () => void promptInstall() },
        cancel: { label: 'Nicht jetzt', onClick: () => dismissInstall() },
      });
    } else {
      toast.dismiss('pwa-install');
    }
  });

  $effect(() => {
    if ($needRefresh) {
      // A new app update is available — let a "Nicht jetzt" from an earlier
      // version ask again instead of staying silenced for the rest of the
      // session (see $lib/pwa/install.ts).
      resetInstallDismissal();
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

  // Server nicht erreichbar (issue #381). Bewusst an `$isOnline` gekoppelt: ist
  // das Gerät selbst offline, ist das die speziellere Diagnose und besitzt
  // bereits den Toast darüber — sonst stünden zwei Meldungen für dasselbe
  // Ereignis nebeneinander. `reachable === null` heißt „noch nichts angefragt"
  // und darf nichts behaupten.
  const serverDown = $derived($isOnline && $serverStatus.reachable === false);
  const serverDownDescription = $derived(
    $serverStatus.stale && $serverStatus.cachedAt
      ? `Anzeige aus dem Zwischenspeicher — Stand: ${formatDateTime($serverStatus.cachedAt)}.`
      : 'Angezeigte Werte können unvollständig oder veraltet sein.',
  );

  async function recheckServer() {
    // Ergebnis wird von der Reachability-Schicht im API-Client verbucht; ein
    // erfolgreicher Probe räumt den Toast von selbst ab und stößt über
    // `recoveries` das Nachladen der Seiten an.
    try {
      await api.health();
    } catch {
      /* weiterhin nicht erreichbar — der Toast bleibt stehen */
    }
  }

  $effect(() => {
    if (serverDown) {
      toast.error('Server nicht erreichbar', {
        id: 'server-status',
        duration: Infinity,
        description: serverDownDescription,
        action: { label: 'Erneut versuchen', onClick: () => void recheckServer() },
      });
    } else {
      toast.dismiss('server-status');
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
