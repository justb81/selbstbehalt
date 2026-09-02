// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { InvoiceStatus } from '@selbstbehalt/shared';
import InvoicePaymentTrack from './InvoicePaymentTrack.svelte';

const GROUND: InvoiceStatus = {
  review: 'geprüft',
  payment: 'offen',
  submission: 'nicht_eingereicht',
  paid_on: null,
};

function props(status: Partial<InvoiceStatus> = {}, over: Record<string, unknown> = {}) {
  return {
    status: { ...GROUND, ...status },
    isGeprueft: true,
    busy: false,
    onChange: vi.fn(),
    ...over,
  };
}

describe('InvoicePaymentTrack', () => {
  it('reports the entered Zahlungsdatum, which may lie in the future (Terminüberweisung)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(InvoicePaymentTrack, { props: props({}, { onChange }) });

    await user.click(screen.getByRole('button', { name: 'Als bezahlt markieren' }));
    const date = screen.getByLabelText('Zahlungsdatum');
    await user.clear(date);
    await user.type(date, '2026-12-24');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(onChange).toHaveBeenCalledWith('bezahlt', '2026-12-24');
  });

  it('drops a stale error from a previous action when the form opens', async () => {
    const user = userEvent.setup();
    const onOpenForm = vi.fn();
    render(InvoicePaymentTrack, { props: props({}, { onOpenForm }) });

    await user.click(screen.getByRole('button', { name: 'Als bezahlt markieren' }));

    expect(onOpenForm).toHaveBeenCalled();
  });

  it('closes the inline form again on Abbrechen, without reporting anything', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(InvoicePaymentTrack, { props: props({}, { onChange }) });

    await user.click(screen.getByRole('button', { name: 'Als bezahlt markieren' }));
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));

    expect(screen.queryByLabelText('Zahlungsdatum')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Als bezahlt markieren' })).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the paid date and offers the revert once bezahlt', () => {
    render(InvoicePaymentTrack, { props: props({ payment: 'bezahlt', paid_on: '2026-07-01' }) });

    expect(screen.getByText('am 01.07.2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zahlung zurücknehmen' })).toBeInTheDocument();
  });

  it('stays gated while the invoice is not geprüft', () => {
    render(InvoicePaymentTrack, {
      props: props({ review: 'neu' }, { isGeprueft: false }),
    });

    expect(screen.queryByRole('button', { name: 'Als bezahlt markieren' })).not.toBeInTheDocument();
    expect(screen.getByText('Erst nach der Prüfung möglich.')).toBeInTheDocument();
  });

  it('disables its actions while another track is running', () => {
    render(InvoicePaymentTrack, { props: props({}, { busy: true }) });
    expect(screen.getByRole('button', { name: 'Als bezahlt markieren' })).toBeDisabled();
  });
});
