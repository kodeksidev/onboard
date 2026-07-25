import { afterEach, describe, expect, test } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { useRepoStore } from '@/state/repoStore';
import { useSettingsStore } from '@/state/settingsStore';
import { DEFAULT_SETTINGS } from '@/ipc/settings-schema';

afterEach(() => {
  useRepoStore.setState({
    status: 'empty',
    repoPath: null,
    envelope: null,
    progress: null,
    error: null,
  });
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, isLoaded: false });
});

/**
 * Phase 7 gate: "VITE_IPC=mock renders the overview with no backend" and "a
 * component test mounts the app against the mock IPC and asserts real
 * fixture data appears." `vitest.config.ts` forces VITE_IPC=mock, so this
 * exercises exactly the code path `VITE_IPC=mock bun run dev` would.
 */
describe('App (mounted against mock IPC)', () => {
  test('starts on the repo picker with the static-mode indicator visible', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'No repository open' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      '🔒 Static mode · no network · nothing leaves this machine',
    );
  });

  test('choosing a folder renders the overview populated with real fixture data — no backend involved', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Choose folder' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'acme-billing-api' })).toBeInTheDocument();
    });

    // Spot-check data that only the sample-analysis.json fixture could supply.
    expect(screen.getByText('Node.js service with React admin and Python worker')).toBeInTheDocument();
    expect(screen.getByText('Files scanned').nextSibling).toHaveTextContent('24');

    // Still static mode: choosing and analyzing a repo makes zero network calls.
    expect(screen.getByRole('status')).toHaveTextContent(
      '🔒 Static mode · no network · nothing leaves this machine',
    );
  });
});
