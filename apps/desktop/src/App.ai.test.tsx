import { afterEach, describe, expect, test } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { ipc } from '@/ipc/ipc';
import { DEFAULT_SETTINGS } from '@/ipc/settings-schema';
import { MODE_INDICATOR } from '@/copy/messages';
import { useAiStore } from '@/state/aiStore';
import { useGraphStore } from '@/state/graphStore';
import { useRepoStore } from '@/state/repoStore';
import { useSettingsStore } from '@/state/settingsStore';
import { SLOW_MOUNT_TIMEOUT_MS } from '@/test/timeouts';

const MODEL = 'claude-opus-4-1';

/** Turned on the way a user turns it on: through the same mock IPC commands Settings calls. */
async function enableAi(): Promise<void> {
  await ipc.storeAiKey({ provider: 'anthropic', apiKey: 'sk-test-key' });
  await ipc.updateSettings({
    ai: { ...DEFAULT_SETTINGS.ai, isEnabled: true, hasStoredKey: true, model: MODEL },
  });
}

afterEach(async () => {
  await ipc.updateSettings({ ai: DEFAULT_SETTINGS.ai });
  await ipc.clearAiKey({ provider: 'anthropic' });
  useRepoStore.setState({ status: 'empty', repoPath: null, envelope: null, progress: null, error: null });
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, isLoaded: false, isSettingsOpen: false });
  useGraphStore.setState({ selectedPath: null, focusedPath: null, focusToken: 0, searchFocusToken: 0 });
  useAiStore.getState().reset();
});

describe('AI mode indicator (criterion 14)', () => {
  test('reads exactly "☁️ AI mode · <provider>/<model> · snippets sent to <provider>" with the real values', async () => {
    await enableAi();
    render(<App />);

    await waitFor(() => {
      expect(useSettingsStore.getState().settings.ai.isEnabled).toBe(true);
    });

    // Byte-exact, not a substring match: the separators are U+00B7, the cloud
    // carries its variation selector, and both provider and model come from
    // the settings the backend actually reported.
    expect(screen.getByRole('status').textContent).toBe(
      '☁️ AI mode · anthropic/claude-opus-4-1 · snippets sent to anthropic',
    );
    expect(screen.getByRole('status').textContent).toBe(MODE_INDICATOR.ai('anthropic', MODEL));
  });

  test('stays byte-exactly in static mode while AI is off, whatever else is configured', () => {
    render(<App />);

    expect(screen.getByRole('status').textContent).toBe(
      '🔒 Static mode · no network · nothing leaves this machine',
    );
  });
});

describe('the "Ask AI" tab', () => {
  test('is reachable with AI off and explains why nothing can be asked yet', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Choose folder' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'acme-billing-api' })).toBeInTheDocument());

    await user.click(screen.getByRole('tab', { name: 'Ask AI' }));

    expect(screen.getByRole('heading', { name: 'AI is off' })).toBeInTheDocument();
    expect(screen.getByRole('status').textContent).toBe(
      '🔒 Static mode · no network · nothing leaves this machine',
    );
  });

  /**
   * The citation seam, end to end: a citation must land the user exactly where
   * a search hit does. It reuses `App.tsx`'s one `onOpenFile` handler, which
   * opens the File viewer AND focuses the same path in `graphStore` — no
   * second focus mechanism was added for AI answers.
   */
  test('clicking a citation opens the cited file and focuses it in the graph store', { timeout: SLOW_MOUNT_TIMEOUT_MS }, async () => {
    const user = userEvent.setup();
    await enableAi();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Choose folder' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'acme-billing-api' })).toBeInTheDocument());

    await user.click(screen.getByRole('tab', { name: 'Ask AI' }));
    await user.click(screen.getByRole('button', { name: 'Summarise this project' }));
    const citations = await screen.findAllByRole('button', { name: /^Open .+, line 1$/ });
    const citation = citations[0]!;
    const citedPath = (citation.getAttribute('aria-label') ?? '').replace(/^Open /, '').replace(/, line 1$/, '');
    await user.click(citation);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'File viewer', selected: true })).toBeInTheDocument();
    });
    expect(useGraphStore.getState().focusedPath).toBe(citedPath);
  });
});
