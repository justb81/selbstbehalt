<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Einstellungs-Seite (docs/design.md §6.1, issue #20): Server-URL, X-API-Key,
  Steuersatz, Diskontrate sowie DB-Export/-Import.
-->
<script lang="ts">
  import { z } from 'zod';
  import { importResultSchema } from '@selbstbehalt/shared';
  import { settings, resolveApiBaseUrl, resolveApiKey } from '$lib/stores/settings';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Card, CardContent } from '$lib/components/ui/card';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';
  import { Separator } from '$lib/components/ui/separator';

  const settingsSchema = z.object({
    apiUrl: z.string(),
    apiKey: z.string(),
    taxRatePct: z
      .number({ invalid_type_error: 'Muss eine Zahl sein' })
      .min(0, 'Muss ≥ 0 % sein')
      .max(100, 'Muss ≤ 100 % sein'),
    discountRatePct: z
      .number({ invalid_type_error: 'Muss eine Zahl sein' })
      .min(0, 'Muss ≥ 0 % sein'),
    claimFreeProbabilityPct: z
      .number({ invalid_type_error: 'Muss eine Zahl sein' })
      .min(0, 'Muss ≥ 0 % sein')
      .max(100, 'Muss ≤ 100 % sein'),
  });

  // Local editable copies (displayed as %)
  let apiUrl = $state($settings.apiUrl);
  let apiKey = $state($settings.apiKey);
  let taxRatePct = $state($settings.taxRate * 100);
  let discountRatePct = $state($settings.discountRate * 100);
  let claimFreeProbabilityPct = $state($settings.claimFreeProbability * 100);

  let saveError = $state<string | null>(null);
  let savedOk = $state(false);

  function save() {
    saveError = null;
    savedOk = false;
    const result = settingsSchema.safeParse({
      apiUrl,
      apiKey,
      taxRatePct,
      discountRatePct,
      claimFreeProbabilityPct,
    });
    if (!result.success) {
      saveError = result.error.issues.map((i) => i.message).join(' · ');
      return;
    }
    settings.update((s) => ({
      ...s,
      apiUrl: apiUrl.trim(),
      apiKey: apiKey.trim(),
      taxRate: taxRatePct / 100,
      discountRate: discountRatePct / 100,
      claimFreeProbability: claimFreeProbabilityPct / 100,
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
      const today = new Date().toISOString().slice(0, 10);
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
      const url = resolveApiBaseUrl() + '/api/import/db';
      const formData = new FormData();
      formData.append('file', file);
      const headers: Record<string, string> = {};
      const key = resolveApiKey();
      if (key) headers['X-API-Key'] = key;
      const res = await fetch(url, { method: 'POST', headers, body: formData });
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
              <Label for="taxRate">Grenzsteuersatz (%)</Label>
              <Input
                id="taxRate"
                type="number"
                bind:value={taxRatePct}
                min="0"
                max="100"
                step="0.5"
                required
              />
              <p class="text-xs text-muted-foreground">
                Wird für den §33-EStG-Steuervorteil benötigt (0–100 %).
              </p>
            </div>

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
        <label class="cursor-pointer">
          <span
            class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all border border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground px-4 py-2 cursor-pointer"
            >Backup auswählen …</span
          >
          <input type="file" accept=".sqlite,.db,.sqlite3" onchange={onFileChosen} class="hidden" />
        </label>
      </div>

      {#if importConfirmFile}
        <div
          class="rounded-md border border-destructive/40 bg-destructive/5 p-4 space-y-3"
          role="alertdialog"
          aria-modal="true"
        >
          <p class="text-sm leading-relaxed">
            <strong>Wirklich importieren?</strong><br />
            Die Datei <code class="font-mono">{importConfirmFile.name}</code> überschreibt alle aktuellen
            Daten unwiderruflich.
          </p>
          <div class="flex flex-wrap gap-2">
            <Button variant="destructive" onclick={confirmImport} disabled={importing}>
              {importing ? 'Wird importiert …' : 'Ja, jetzt importieren'}
            </Button>
            <Button variant="outline" onclick={cancelImport} disabled={importing}>Abbrechen</Button>
          </div>
        </div>
      {/if}
    </CardContent>
  </Card>
</div>
