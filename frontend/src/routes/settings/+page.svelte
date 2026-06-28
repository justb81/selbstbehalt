<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Einstellungs-Seite (docs/design.md §6.1, issue #20): Server-URL, X-API-Key,
  Steuersatz, Diskontrate sowie DB-Export/-Import.
-->
<script lang="ts">
  import { z } from 'zod';
  import { importResultSchema } from '@selbstbehalt/shared';
  import { settings, resolveApiBaseUrl, resolveApiKey } from '$lib/stores/settings';

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
  });

  // Local editable copies (displayed as %)
  let apiUrl = $state($settings.apiUrl);
  let apiKey = $state($settings.apiKey);
  let taxRatePct = $state($settings.taxRate * 100);
  let discountRatePct = $state($settings.discountRate * 100);

  let saveError = $state<string | null>(null);
  let savedOk = $state(false);

  function save() {
    saveError = null;
    savedOk = false;
    const result = settingsSchema.safeParse({ apiUrl, apiKey, taxRatePct, discountRatePct });
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

<section class="settings-page">
  <h1>Einstellungen</h1>

  <form
    class="card"
    onsubmit={(e) => {
      e.preventDefault();
      save();
    }}
  >
    <h2>Verbindung</h2>

    <label class="field">
      <span>Server-URL</span>
      <input
        type="url"
        bind:value={apiUrl}
        placeholder="http://localhost:8080"
        autocomplete="url"
      />
      <small>Leer lassen für Standardwert (<code>PUBLIC_API_URL</code> oder localhost).</small>
    </label>

    <label class="field">
      <span>X-API-Key <span class="optional">(optional)</span></span>
      <input
        type="password"
        bind:value={apiKey}
        placeholder="Nur für VPN/externen Zugriff erforderlich"
        autocomplete="off"
      />
    </label>

    <h2>Günstigerprüfung</h2>

    <div class="field-row">
      <label class="field">
        <span>Grenzsteuersatz (%)</span>
        <input type="number" bind:value={taxRatePct} min="0" max="100" step="0.5" required />
        <small>Wird für den §33-EStG-Steuervorteil benötigt (0–100 %).</small>
      </label>

      <label class="field">
        <span>Diskontrate (% p.a.)</span>
        <input type="number" bind:value={discountRatePct} min="0" step="0.1" required />
        <small>Abdiskontierung des BRE-Vorteils; Design-Standard: 3 %.</small>
      </label>
    </div>

    {#if saveError}
      <p class="msg error" role="alert">{saveError}</p>
    {/if}
    {#if savedOk}
      <p class="msg success" role="status">Einstellungen gespeichert.</p>
    {/if}

    <div class="actions">
      <button type="submit" class="btn-primary">Speichern</button>
    </div>
  </form>

  <div class="card">
    <h2>Datenbank-Backup</h2>

    <div class="backup-row">
      <div>
        <strong>Exportieren</strong>
        <p class="backup-desc">Aktuelle Datenbank als SQLite-Datei herunterladen.</p>
        {#if exportError}
          <p class="msg error" role="alert">{exportError}</p>
        {/if}
      </div>
      <button type="button" class="btn-secondary" onclick={exportDb} disabled={exporting}>
        {exporting ? 'Wird exportiert …' : 'Export herunterladen'}
      </button>
    </div>

    <hr />

    <div class="backup-row">
      <div>
        <strong>Importieren</strong>
        <p class="backup-desc">
          SQLite-Backup wiederherstellen. <em>Achtung: überschreibt alle aktuellen Daten.</em>
        </p>
        {#if importError}
          <p class="msg error" role="alert">{importError}</p>
        {/if}
        {#if importResult}
          <p class="msg success" role="status">
            Import erfolgreich: {importResult.tables_imported} Tabellen,
            {importResult.rows_imported} Datensätze.
          </p>
        {/if}
      </div>
      <label class="btn-secondary file-label">
        Backup auswählen …
        <input type="file" accept=".sqlite,.db,.sqlite3" onchange={onFileChosen} hidden />
      </label>
    </div>

    {#if importConfirmFile}
      <div class="import-confirm" role="alertdialog" aria-modal="true">
        <p>
          <strong>Wirklich importieren?</strong><br />
          Die Datei <code>{importConfirmFile.name}</code> überschreibt alle aktuellen Daten unwiderruflich.
        </p>
        <div class="actions">
          <button type="button" class="btn-danger" onclick={confirmImport} disabled={importing}>
            {importing ? 'Wird importiert …' : 'Ja, jetzt importieren'}
          </button>
          <button type="button" class="btn-secondary" onclick={cancelImport} disabled={importing}>
            Abbrechen
          </button>
        </div>
      </div>
    {/if}
  </div>
</section>

<style>
  .settings-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  h1 {
    margin: 0;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
  }

  h2 {
    margin: 0;
    font-size: var(--font-size-base);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 0.8rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    flex: 1;
  }

  .field input {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font: inherit;
    color: var(--color-text);
    background: var(--color-bg);
  }

  .field input:focus {
    outline: 2px solid var(--color-primary);
    outline-offset: 1px;
  }

  .field small {
    color: var(--color-text-muted);
  }

  .optional {
    font-weight: 400;
    font-style: italic;
  }

  .field-row {
    display: flex;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .btn-primary {
    padding: var(--space-2) var(--space-5);
    border: none;
    border-radius: var(--radius-sm);
    background: var(--color-primary);
    color: var(--color-primary-contrast);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--color-primary-strong);
  }

  .btn-secondary {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--color-bg);
  }

  .btn-danger {
    padding: var(--space-2) var(--space-4);
    border: none;
    border-radius: var(--radius-sm);
    background: var(--color-danger);
    color: #fff;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-danger) 85%, black);
  }

  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .file-label {
    cursor: pointer;
    white-space: nowrap;
  }

  .backup-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .backup-desc {
    margin: var(--space-1) 0 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  hr {
    border: none;
    border-top: 1px solid var(--color-border);
    margin: 0;
  }

  .import-confirm {
    padding: var(--space-4);
    border: 1px solid color-mix(in srgb, var(--color-danger) 40%, var(--color-border));
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-danger) 5%, var(--color-surface));
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .import-confirm p {
    margin: 0;
    font-size: var(--font-size-sm);
    line-height: 1.6;
  }

  .msg {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
  }

  .msg.error {
    background: color-mix(in srgb, var(--color-danger) 8%, var(--color-surface));
    color: var(--color-danger);
  }

  .msg.success {
    background: color-mix(in srgb, var(--color-success) 8%, var(--color-surface));
    color: var(--color-success);
  }
</style>
