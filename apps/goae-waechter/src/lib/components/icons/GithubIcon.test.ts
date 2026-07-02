// SPDX-License-Identifier: Apache-2.0
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

import GithubIcon from './GithubIcon.svelte';

describe('GithubIcon', () => {
  it('renders a decorative, non-focusable svg mark', () => {
    const { container } = render(GithubIcon);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg?.querySelector('path')).toBeInTheDocument();
  });

  it('merges a custom class with the default size', () => {
    const { container } = render(GithubIcon, { class: 'text-primary' });
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('size-4', 'text-primary');
  });
});
