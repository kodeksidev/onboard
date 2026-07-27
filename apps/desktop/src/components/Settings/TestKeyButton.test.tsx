import { beforeEach, describe, expect, test } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@/ipc/settings-schema';
import { useSettingsStore } from '@/state/settingsStore';
import { TestKeyButton } from './TestKeyButton';

/**
 * `VITE_IPC=mock` (vitest.config.ts) means `useSettingsStore` calls the
 * REAL mock IPC implementation (`ipc/mock-ipc.ts`), not a hand-mocked
 * double — so these tests exercise the actual `testAiKey` round trip the
 * store makes, the same code path `VITE_IPC=mock bun run dev` uses.
 * Resetting via the real `updateSettings` call (not just the Zustand
 * snapshot) also resets the mock IPC's own internal state, since that
 * mock is a module-level singleton shared across tests in this file.
 */
async function resetSettings(): Promise<void> {
  await useSettingsStore.getState().updateSettings({ ai: DEFAULT_SETTINGS.ai });
}

beforeEach(async () => {
  await resetSettings();
});

describe('TestKeyButton', () => {
  test('shows a pass state with real measured latency when the mock accepts the stored key', async () => {
    const user = userEvent.setup();
    await useSettingsStore.getState().storeAiKey('anthropic', 'sk-ant-test-key-0000000000000');

    render(<TestKeyButton provider="anthropic" model="claude-sonnet-4-5" />);
    await user.click(screen.getByRole('button', { name: 'Test key' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/Connected — responded in \d+ms\./);
    });
  });

  test('shows a distinguishing failure state (never a generic message) when no key is stored', async () => {
    const user = userEvent.setup();

    render(<TestKeyButton provider="anthropic" model="claude-sonnet-4-5" />);
    await user.click(screen.getByRole('button', { name: 'Test key' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('That key was rejected');
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'anthropic returned 401. Check the key, then test again.',
    );
  });

  test('labels the button "Test connection" (not "Test key") for Ollama — a reachability test, not a credential test', () => {
    render(<TestKeyButton provider="ollama" model="llama3.1:8b" />);
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeInTheDocument();
  });

  test('disables the button while the request is pending', () => {
    render(<TestKeyButton provider="anthropic" model="claude-sonnet-4-5" />);

    // `fireEvent.click` (unlike `userEvent.click`) does not await the
    // click handler's own async work, so the DOM can be inspected in the
    // synchronous instant right after `setState({ status: 'pending' })`
    // runs — before the mock's `testAiKey` promise has had a chance to
    // resolve on a later microtask.
    fireEvent.click(screen.getByRole('button', { name: 'Test key' }));

    expect(screen.getByRole('button', { name: 'Testing…' })).toBeDisabled();
  });
});
