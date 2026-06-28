<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Einreichungsformular (docs/design.md §6.1, issue #22): records the submission
  of an invoice to the insurer and optionally the actual refund received.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import {
    submissionChannelValues,
    type InvoiceWithPositions,
    type SubmissionChannel,
  } from '@selbstbehalt/shared';
  import LoadingState from '$lib/components/LoadingState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';

  const CHANNEL_LABELS: Record<SubmissionChannel, string> = {
    app: 'App',
    post: 'Post',
    email: 'E-Mail',
  };

  const invoiceId = $derived(page.params.id as string);

  let invoice = $state<InvoiceWithPositions | null>(null);
  let loading = $state(true);
  let loadError = $state<string | null>(null);

  async function loadInvoice() {
    loading = true;
    loadError = null;
    try {
      invoice = await api.invoices.get(invoiceId);
    } catch (e) {
      loadError = e instanceof ApiError || e instanceof Error ? e.message : 'Laden fehlgeschlagen.';
    } finally {
      loading = false;
    }
  }

  onMount(loadInvoice);

  // ---- Form state ----
  const nowIso = new Date().toISOString().slice(0, 16); // datetime-local format
  let submittedAt = $state(nowIso);
  let submittedVia = $state<SubmissionChannel>('app');
  let expectedRefund = $state<number | null>(null);
  let actualRefund = $state<number | null>(null);
  let refundDate = $state('');
  let rejectionReason = $state('');
  let isRejected = $state(false);

  let saving = $state(false);
  let formError = $state<string | null>(null);

  async function submit() {
    if (!invoice) return;
    saving = true;
    formError = null;
    try {
      await api.invoices.submit(invoice.id, {
        submitted_at: submittedAt ? `${submittedAt}:00Z` : null,
        submitted_via: submittedVia,
        expected_refund: expectedRefund,
        actual_refund: actualRefund,
        refund_date: refundDate.trim() || null,
        rejection_reason: isRejected ? rejectionReason.trim() || null : null,
      });
      await goto(resolve('/invoices/[id]', { id: invoice.id }));
    } catch (e) {
      formError =
        e instanceof ApiError || e instanceof Error
          ? e.message
          : 'Einreichung konnte nicht gespeichert werden.';
      saving = false;
    }
  }
</script>

<svelte:head><title>Einreichung · selbstbehalt</title></svelte:head>

<section class="page">
  <div class="back-row">
    <a href={resolve('/invoices/[id]', { id: invoiceId })} class="back-link">← Rechnungsdetail</a>
  </div>

  <h1>Einreichung</h1>

  {#if loading}
    <LoadingState label="Rechnungsdaten werden geladen …" />
  {:else if loadError}
    <ErrorState title="Fehler" message={loadError} onRetry={loadInvoice} />
  {:else if invoice}
    <p class="subtitle">
      Rechnung <strong>{invoice.provider_name}</strong> vom {invoice.invoice_date}
    </p>

    <form
      class="card"
      onsubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h2>Einreichung</h2>
      <div class="field-grid">
        <label class="field">
          <span>Eingereicht am</span>
          <input type="datetime-local" bind:value={submittedAt} />
        </label>

        <label class="field">
          <span>Einreichungsweg</span>
          <select bind:value={submittedVia}>
            {#each submissionChannelValues as ch (ch)}
              <option value={ch}>{CHANNEL_LABELS[ch]}</option>
            {/each}
          </select>
        </label>

        <label class="field">
          <span>Erwartete Erstattung (€)</span>
          <input
            type="number"
            value={expectedRefund ?? ''}
            oninput={(e) => {
              const v = (e.target as HTMLInputElement).value;
              expectedRefund = v ? parseFloat(v) : null;
            }}
            min="0"
            step="0.01"
            placeholder="optional"
          />
        </label>
      </div>

      <h2>Erstattung</h2>
      <p class="help-text">
        Nach Eingang des Erstattungsbescheids hier eintragen. Kann auch später ergänzt werden.
      </p>
      <div class="field-grid">
        <label class="field">
          <span>Tatsächliche Erstattung (€)</span>
          <input
            type="number"
            value={actualRefund ?? ''}
            oninput={(e) => {
              const v = (e.target as HTMLInputElement).value;
              actualRefund = v ? parseFloat(v) : null;
            }}
            min="0"
            step="0.01"
            placeholder="optional"
          />
        </label>

        <label class="field">
          <span>Erstattungsdatum</span>
          <input type="date" bind:value={refundDate} />
        </label>
      </div>

      <label class="checkbox-label">
        <input type="checkbox" bind:checked={isRejected} />
        <span>Rechnung wurde abgelehnt</span>
      </label>

      {#if isRejected}
        <label class="field">
          <span>Ablehnungsgrund</span>
          <textarea bind:value={rejectionReason} rows="3" placeholder="optional"></textarea>
        </label>
      {/if}

      {#if formError}
        <p class="error" role="alert">{formError}</p>
      {/if}

      <div class="actions">
        <button type="submit" class="btn-primary" disabled={saving}>
          {saving ? 'Wird gespeichert …' : 'Einreichung speichern'}
        </button>
        <a href={resolve('/invoices/[id]', { id: invoiceId })} class="btn-secondary"> Abbrechen </a>
      </div>
    </form>
  {/if}
</section>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  h1 {
    margin: 0;
  }
  h2 {
    margin: 0;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
  }

  .back-link {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    text-decoration: none;
  }
  .back-link:hover {
    color: var(--color-primary);
  }

  .subtitle {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }
  .help-text {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
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

  .field-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
    gap: var(--space-3);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .field input,
  .field select,
  .field textarea {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font: inherit;
    color: var(--color-text);
    background: var(--color-bg);
    resize: vertical;
  }

  .field input:focus,
  .field select:focus,
  .field textarea:focus {
    outline: 2px solid var(--color-primary);
    outline-offset: 1px;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
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
  .btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-secondary {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    font-weight: 500;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
  }
  .btn-secondary:hover {
    background: var(--color-bg);
  }

  .error {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
    margin: 0;
  }
</style>
