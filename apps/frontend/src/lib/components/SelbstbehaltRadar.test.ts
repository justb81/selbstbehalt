// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

import type { SBRadar } from '$lib/utils/selbstbehalt-radar';
import SelbstbehaltRadar from './SelbstbehaltRadar.svelte';

/** Build an SBRadar fixture; `gcp` is unused by the component, so `null` is fine. */
function radar(overrides: Partial<SBRadar> = {}): SBRadar {
  return {
    year: 2024,
    R_Y: 300,
    selbstbehalt: 500,
    npvThreshold: 750,
    gcpThreshold: 1250,
    sbExhaustion: 0.6,
    restBisEinreichen: 950,
    state: 'unter_sb',
    alreadyBroken: false,
    gcp: null,
    ...overrides,
  };
}

describe('SelbstbehaltRadar — states', () => {
  it('renders the unter_sb state', () => {
    render(SelbstbehaltRadar, { props: { radar: radar({ state: 'unter_sb' }) } });
    expect(screen.getByText('Unter Selbstbehalt')).toBeInTheDocument();
    expect(screen.getByText(/bis zum Selbstbehalt/)).toBeInTheDocument();
  });

  it('renders the sb_erreicht_unter_schwelle state', () => {
    render(SelbstbehaltRadar, {
      props: { radar: radar({ state: 'sb_erreicht_unter_schwelle', R_Y: 800 }) },
    });
    expect(screen.getByText('SB erreicht')).toBeInTheDocument();
    expect(screen.getByText(/bis Einreichen lohnt/)).toBeInTheDocument();
  });

  it('renders the ueber_schwelle state', () => {
    render(SelbstbehaltRadar, {
      props: { radar: radar({ state: 'ueber_schwelle', R_Y: 1400, restBisEinreichen: 0 }) },
    });
    expect(screen.getByText('Einreichen lohnt')).toBeInTheDocument();
    expect(screen.getByText(/Schwelle überschritten — alle 2024er einreichen/)).toBeInTheDocument();
  });

  it('renders the bereits_gebrochen state', () => {
    render(SelbstbehaltRadar, {
      props: {
        radar: radar({
          state: 'bereits_gebrochen',
          alreadyBroken: true,
          npvThreshold: 0,
          gcpThreshold: 500,
        }),
      },
    });
    expect(screen.getByText('Staffel gerissen')).toBeInTheDocument();
    expect(screen.getByText(/Staffel gerissen — alle 2024er einreichen/)).toBeInTheDocument();
  });
});

describe('SelbstbehaltRadar — thermometer & markers', () => {
  it('exposes a progressbar with the exhaustion value', () => {
    render(SelbstbehaltRadar, { props: { radar: radar({ sbExhaustion: 0.6 }) } });
    const bar = screen.getByRole('progressbar');
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveAttribute('aria-valuenow', '60');
  });

  it('shows the Einreich-Schwelle legend only when the threshold exceeds S (full variant)', () => {
    const { unmount } = render(SelbstbehaltRadar, {
      props: { radar: radar({ selbstbehalt: 500, gcpThreshold: 1250 }) },
    });
    expect(screen.getByText(/Einreich-Schwelle/)).toBeInTheDocument();
    unmount();

    // No BRE loss → threshold collapses to S → no separate threshold legend.
    render(SelbstbehaltRadar, {
      props: { radar: radar({ selbstbehalt: 500, gcpThreshold: 500, npvThreshold: 0 }) },
    });
    expect(screen.queryByText(/Einreich-Schwelle/)).not.toBeInTheDocument();
  });

  it('shows the exhaustion percentage in the full variant', () => {
    render(SelbstbehaltRadar, { props: { radar: radar({ sbExhaustion: 0.6 }) } });
    expect(screen.getByText(/60 % ausgeschöpft/)).toBeInTheDocument();
  });
});

describe('SelbstbehaltRadar — compact variant', () => {
  it('renders the given label and the status badge', () => {
    render(SelbstbehaltRadar, {
      props: { radar: radar(), label: 'Max Müller', compact: true },
    });
    expect(screen.getByText('Max Müller')).toBeInTheDocument();
    expect(screen.getByText('Unter Selbstbehalt')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('becomes a link when href is provided', () => {
    render(SelbstbehaltRadar, {
      props: { radar: radar(), compact: true, href: '/insured/abc' },
    });
    expect(screen.getByRole('link')).toHaveAttribute('href', '/insured/abc');
  });

  it('falls back to a default label when none is given', () => {
    render(SelbstbehaltRadar, { props: { radar: radar({ year: 2024 }), compact: true } });
    expect(screen.getByText('Selbstbehalt 2024')).toBeInTheDocument();
  });
});
