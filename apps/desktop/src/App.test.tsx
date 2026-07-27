import { afterEach, describe, expect, test } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { useRepoStore } from '@/state/repoStore';
import { useSettingsStore } from '@/state/settingsStore';
import { useGraphStore } from '@/state/graphStore';
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
  useGraphStore.setState({ selectedPath: null, focusedPath: null, focusToken: 0, searchFocusToken: 0 });
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

  /**
   * Section 9 Phase 10's reuse instruction: `onOpenFile` must actually do
   * something end-to-end, not just be accepted and ignored (every panel
   * already declared the prop before this phase, but `App.tsx` never wired
   * a handler — a dead control until now). Also proves the "reuse
   * `focusPath`" instruction: opening a file from a search hit is expected
   * to focus that same path in `graphStore`, the one cross-component focus
   * seam, rather than a second one.
   */
  test('clicking a "where is x?" result opens that file, at that line, in the File viewer tab', async () => {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 384 });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Choose folder' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'acme-billing-api' })).toBeInTheDocument());

    await user.click(screen.getByRole('tab', { name: 'Where is X?' }));
    await user.type(screen.getByRole('combobox', { name: 'Where is X?' }), 'authenticate');
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));

    await user.click(screen.getByRole('button', { name: /open src\/services\/auth\.service\.ts, line 22/i }));

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'File viewer', selected: true })).toBeInTheDocument();
    });
    // FileViewer is React.lazy'd, so this waits on a dynamic chunk import AND
    // CodeMirror's own initialisation. waitFor defaults to 1s, which this
    // exceeds whenever the suite runs in parallel on a loaded machine — the
    // failure then reads "expected null not to be null", which looks like a
    // logic bug rather than the clock running out. Give it room explicitly.
    await waitFor(
      () => {
        expect(document.querySelector('.cm-editor')).not.toBeNull();
      },
      { timeout: 15_000 },
    );
    expect(useGraphStore.getState().focusedPath).toBe('src/services/auth.service.ts');
  });
});
