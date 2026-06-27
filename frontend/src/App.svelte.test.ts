// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

import App from './App.svelte';

describe('App', () => {
  it('renders the application heading', () => {
    render(App);
    expect(screen.getByRole('heading', { name: 'selbstbehalt' })).toBeInTheDocument();
  });

  it('renders the passed Selbstbehalt formatted as EUR', () => {
    render(App, { selbstbehalt: 1234 });
    expect(screen.getByText(/1\.234,00/)).toBeInTheDocument();
  });
});
