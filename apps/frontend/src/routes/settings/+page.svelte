<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Einstellungs-Seite (docs/architecture.md §5.2, issue #20): Server-URL, X-API-Key,
  Diskontrate sowie DB-Export/-Import.
-->
<script lang="ts">
  import { z } from 'zod';
  import { importResultSchema, todayIso } from '@selbstbehalt/shared';
  import { settings, resolveApiBaseUrl, resolveApiKey } from '$lib/stores/settings';
  import { Button } from '@selbstbehalt/ui/button';
  import { Input } from '@selbstbehalt/ui/input';
  import { Label } from '@selbstbehalt/ui/label';
  import { Card, CardContent } from '@selbstbehalt/ui/card';
  import { Alert, AlertDescription } from '@selbstbehalt/ui/alert';
  import { Separator } from '@selbstbehalt/ui/separator';
  import { Switch } from '$lib/components/ui/switch';
  import {
    AlertDialogRoot,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogFooter,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogAction,
    AlertDialogCancel,
  } from '$lib/components/ui/alert-dialog';

  const settingsSchema = z.object({
    apiUrl: z.string(),
    apiKey: z.string(),
    discountRatePct: z.number({ error: 'Muss eine Zahl sein' }).min(0, 'Muss ≥ 0 % sein'),
    claimFreeProbabilityPct: z
      .number({ error: 'Muss eine Zahl sein' })
      .min(0, 'Muss ≥ 0 % sein')
      .max(100, 'Muss ≤ 100 % sein'),
    defaultPaymentTermDays: z
      .number({ error: 'Muss eine Zahl sein' })
      .int('Muss eine ganze Zahl sein')
      .min(0, 'Muss ≥ 0 Tage sein')
      .max(365, 'Muss ≤ 365 Tage sein'),
    paymentReminderLeadDays: z
      .number({ error: 'Muss eine Zahl sein' })
      .int('Muss eine ganze Zahl sein')
      .min(0, 'Muss ≥ 0 Tage sein')
      .max(365, 'Muss ≤ 365 Tage sein'),
  });

  // Local editable copies (displayed as %)
  let apiUrl = $state($settings.apiUrl);
  let apiKey = $state($settings.apiKey);
  let discountRatePct = $state($settings.discountRate * 100);
  let claimFreeProbabilityPct = $state($settings.claimFreeProbability * 100);
  let defaultPaymentTermDays = $state($settings.defaultPaymentTermDays);
  let paymentReminderLeadDays = $state($settings.paymentReminderLeadDays);
  let remindersEnabled = $state($settings.paymentRemindersEnabled);

  let saveError = $state<string | null>(null);
  let savedOk = $state(false);

  function save() {
    saveError = null;
    savedOk = false;
    const result = settingsSchema.safeParse({
      apiUrl,
      apiKey,
      discountRatePct,
      claimFreeProbabilityPct,
      defaultPaymentTermDays,
      paymentReminderLeadDays,
    });
    if (!result.success) {
      saveError = result.error.issues.map((i) => i.message).join(' · ');
      return;
    }
    settings.update((s) => ({
      ...s,
      apiUrl: apiUrl.trim(),
      apiKey: apiKey.trim(),
      discountRate: discountRatePct / 100,
      claimFreeProbability: claimFreeProbabilityPct / 100,
      defaultPaymentTermDays,
      paymentReminderLeadDays,
      paymentRemindersEnabled: remindersEnabled,
    }));
    savedOk = true;
    setTimeout(() => (savedOk = false), 3000);
  }

  // DB Export
  let exporting = $state(false);
  let exportError = $state<string | null>(null);

  async function exportDb() {
    exporting = true;
    exportError = null;
    try {
      const url = resolveApiBaseUrl() + '/api/export/db';
      const headers: Record<string, string> = {};
      const key = resolveApiKey();
      if (key) headers['X-API-Key'] = key;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`Server antwortete mit ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const today = todayIso();
      a.href = blobUrl;
      a.download = `selbstbehalt-backup-${today}.sqlite`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      exportError = e instanceof Error ? e.message : 'Export fehlgeschlagen.';
    } finally {
      exporting = false;
    }
  }

  // DB Import
  let importConfirmFile = $state<File | null>(null);
  let importing = $state(false);
  let importError = $state<string | null>(null);
  let importResult = $state<{ tables_imported: number; rows_imported: number } | null>(null);

  let fileInput = $state<HTMLInputElement | null>(null);

  function onFileChosen(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (file) {
      importConfirmFile = file;
      importError = null;
      importResult = null;
    }
  }

  function cancelImport() {
    importConfirmFile = null;
  }

  async function confirmImport() {
    if (!importConfirmFile) return;
    importing = true;
    importError = null;
    importResult = null;
    const file = importConfirmFile;
    importConfirmFile = null;
    try {
      // Raw binary body, not a multipart form: the backend accepts nothing
      // else, so that no cross-site `<form>` can reach the destructive restore
      // (#404). `?confirm=true` is the endpoint's second, explicit guard.
      const url = resolveApiBaseUrl() + '/api/import/db?confirm=true';
      const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
      const key = resolveApiKey();
      if (key) headers['X-API-Key'] = key;
      const res = await fetch(url, { method: 'POST', headers, body: file });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          json && typeof json === 'object' && 'error' in json
            ? (json as { error: { message: string } }).error.message
            : `Server antwortete mit ${res.status}`;
        throw new Error(msg);
      }
      const parsed = importResultSchema.safeParse(json);
      if (!parsed.success) throw new Error('Unerwartete Server-Antwort');
      importResult = parsed.data;
    } catch (e) {
      importError = e instanceof Error ? e.message : 'Import fehlgeschlagen.';
    } finally {
      importing = false;
    }
  }
</script>

<svelte:head><title>Einstellungen · selbstbehalt</title></svelte:head>

<div class="container mx-auto max-w-5xl px-4 py-8 space-y-6">
  <h1 class="text-2xl font-bold tracking-tight">Einstellungen</h1>

  <form
    onsubmit={(e) => {
      e.preventDefault();
      save();
    }}
  >
    <Card>
      <CardContent class="pt-6 space-y-6">
        <div class="space-y-4">
          <p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Verbindung
          </p>

          <div class="space-y-1">
            <Label for="apiUrl">Server-URL</Label>
            <Input
              id="apiUrl"
              type="url"
              bind:value={apiUrl}
              placeholder="https://backend.example.com"
              autocomplete="url"
            />
            <p class="text-xs text-muted-foreground">
              Leer lassen für gleiche Origin (Standard): <code class="font-mono">/api</code> wird vom
              Reverse Proxy ans Backend weitergeleitet. Nur setzen, wenn das Backend auf einer eigenen
              Origin läuft (dann auch X-API-Key nötig).
            </p>
          </div>

          <div class="space-y-1">
            <Label for="apiKey">
              X-API-Key <span class="font-normal italic text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="apiKey"
              type="password"
              bind:value={apiKey}
              placeholder="Nur für VPN/externen Zugriff erforderlich"
              autocomplete="off"
            />
          </div>
        </div>

        <Separator />

        <div class="space-y-4">
          <p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Günstigerprüfung
          </p>

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div class="space-y-1">
              <Label for="discountRate">Diskontrate (% p.a.)</Label>
              <Input
                id="discountRate"
                type="number"
                bind:value={discountRatePct}
                min="0"
                step="0.1"
                required
              />
              <p class="text-xs text-muted-foreground">
                Abdiskontierung des BRE-Vorteils; Design-Standard: 3 %.
              </p>
            </div>

            <div class="space-y-1">
              <Label for="claimFreeProbability">Leistungsfreiheit-Wahrscheinlichkeit (%)</Label>
              <Input
                id="claimFreeProbability"
                type="number"
                bind:value={claimFreeProbabilityPct}
                min="0"
                max="100"
                step="1"
                required
              />
              <p class="text-xs text-muted-foreground">
                Wahrscheinlichkeit, ein weiteres Jahr leistungsfrei zu bleiben (p, Design-Standard:
                70 %).
              </p>
            </div>
          </div>
        </div>

        <Separator />

        <div class="space-y-4">
          <p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Zahlungsziel
          </p>

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div class="space-y-1">
              <Label for="defaultPaymentTermDays">Standard-Zahlungsfrist (Tage)</Label>
              <Input
                id="defaultPaymentTermDays"
                type="number"
                bind:value={defaultPaymentTermDays}
                min="0"
                max="365"
                step="1"
                required
              />
              <p class="text-xs text-muted-foreground">
                Vorbelegung des Zahlungsziels, wenn die Rechnung keines nennt. Standard: 30 Tage
                (Verzug tritt erst dann ein).
              </p>
            </div>

            <div class="space-y-1">
              <Label id="paymentReminders-label" for="paymentReminders">Fälligkeits-Hinweise</Label>
              <div class="flex h-8 items-center gap-2">
                <Switch
                  id="paymentReminders"
                  aria-labelledby="paymentReminders-label"
                  bind:checked={remindersEnabled}
                />
                <span class="text-sm text-muted-foreground">
                  {remindersEnabled ? 'Ein' : 'Aus'}
                </span>
              </div>
              <p class="text-xs text-muted-foreground">
                Markiert fällige und überfällige Rechnungen in Listen und im Dashboard. „Aus"
                deaktiviert jede Fälligkeits-Markierung.
              </p>
            </div>

            <div class="space-y-1">
              <Label for="paymentReminderLeadDays">Hinweis ab (Tage vor Zahlungsziel)</Label>
              <Input
                id="paymentReminderLeadDays"
                type="number"
                bind:value={paymentReminderLeadDays}
                min="0"
                max="365"
                step="1"
                disabled={!remindersEnabled}
                required
              />
              <p class="text-xs text-muted-foreground">
                Ab wie vielen Tagen vor dem Zahlungsziel eine Rechnung als fällig markiert wird
                (Standard: 7 Tage).
              </p>
            </div>
          </div>
        </div>

        {#if saveError}
          <Alert variant="destructive">
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        {/if}
        {#if savedOk}
          <Alert>
            <AlertDescription>Einstellungen gespeichert.</AlertDescription>
          </Alert>
        {/if}

        <Button type="submit">Speichern</Button>
      </CardContent>
    </Card>
  </form>

  <Card>
    <CardContent class="pt-6 space-y-6">
      <p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Datenbank-Backup
      </p>

      <div class="flex items-start justify-between gap-4 flex-wrap">
        <div class="space-y-1">
          <p class="font-medium">Exportieren</p>
          <p class="text-sm text-muted-foreground">
            Aktuelle Datenbank als SQLite-Datei herunterladen.
          </p>
          {#if exportError}
            <Alert variant="destructive" class="mt-2">
              <AlertDescription>{exportError}</AlertDescription>
            </Alert>
          {/if}
        </div>
        <Button variant="outline" onclick={exportDb} disabled={exporting}>
          {exporting ? 'Wird exportiert …' : 'Export herunterladen'}
        </Button>
      </div>

      <Separator />

      <div class="flex items-start justify-between gap-4 flex-wrap">
        <div class="space-y-1">
          <p class="font-medium">Importieren</p>
          <p class="text-sm text-muted-foreground">
            SQLite-Backup wiederherstellen. <em>Achtung: überschreibt alle aktuellen Daten.</em>
          </p>
          {#if importError}
            <Alert variant="destructive" class="mt-2">
              <AlertDescription>{importError}</AlertDescription>
            </Alert>
          {/if}
          {#if importResult}
            <Alert class="mt-2">
              <AlertDescription>
                Import erfolgreich: {importResult.tables_imported} Tabellen,
                {importResult.rows_imported} Datensätze.
              </AlertDescription>
            </Alert>
          {/if}
        </div>
        <div>
          <Button variant="outline" onclick={() => fileInput?.click()}>Backup auswählen …</Button>
          <!--
            Rohes <input type="file">: die shadcn-Input-Komponente bindet auch im
            file-Zweig `value`, und ein Datei-Input lässt sich programmatisch nur
            auf "" setzen — Svelte wirft beim Zurückschreiben. Bedient wird es
            ohnehin über den Button, es bleibt nur als sr-only-Fallback im
            Fokus-/A11y-Baum.
          -->
          <input
            bind:this={fileInput}
            type="file"
            accept=".sqlite,.db,.sqlite3"
            onchange={onFileChosen}
            class="sr-only"
            tabindex={-1}
            aria-label="Backup-Datei auswählen"
          />
        </div>
      </div>

      <AlertDialogRoot
        open={importConfirmFile !== null}
        onOpenChange={(open: boolean) => {
          if (!open) cancelImport();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Wirklich importieren?</AlertDialogTitle>
            <AlertDialogDescription>
              Die Datei <code class="font-mono">{importConfirmFile?.name}</code> überschreibt alle aktuellen
              Daten unwiderruflich.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={importing}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onclick={() => void confirmImport()}
              disabled={importing}
            >
              {importing ? 'Wird importiert …' : 'Ja, jetzt importieren'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>
    </CardContent>
  </Card>
</div>
