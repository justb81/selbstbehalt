// SPDX-License-Identifier: Apache-2.0
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import ErrorState from './ErrorState.svelte';
import LoadingState from './LoadingState.svelte';

describe('LoadingState', () => {
  it('renders the default label with a status role', () => {
    render(LoadingState);
    expect(screen.getByRole('status')).toHaveTextContent('Wird geladen …');
  });

  it('renders a custom label', () => {
    render(LoadingState, { props: { label: 'Lade Verträge …' } });
    expect(screen.getByRole('status')).toHaveTextContent('Lade Verträge …');
  });
});

describe('ErrorState', () => {
  it('renders the title and message as an alert', () => {
    render(ErrorState, { props: { title: 'Fehler 500', message: 'Serverfehler' } });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Fehler 500');
    expect(alert).toHaveTextContent('Serverfehler');
  });

  it('omits the retry button when no handler is given', () => {
    render(ErrorState);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('calls onRetry when the retry button is clicked', async () => {
    const onRetry = vi.fn();
    render(ErrorState, { props: { onRetry } });
    await fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
