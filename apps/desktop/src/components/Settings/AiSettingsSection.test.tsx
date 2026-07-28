import { beforeEach, describe, expect, test } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@/ipc/settings-schema';
import { useSettingsStore } from '@/state/settingsStore';
import { AiSettingsSection } from './AiSettingsSection';

async function resetSettings(): Promise<void> {
  await useSettingsStore.getState().updateSettings({ ai: DEFAULT_SETTINGS.ai });
}

beforeEach(async () => {
  await resetSettings();
});

describe('AiSettingsSection', () => {
  test('defaults to the master toggle off (A5/A20)', () => {
    render(<AiSettingsSection />);
    expect(screen.getByRole('checkbox', { name: 'Enable AI features' })).not.toBeChecked();
  });

  /**
   * A4 / §3 non-goal 2, enforced at the one place a user could actually
   * pick a provider. This asserts the exact list rather than "contains
   * Anthropic and Ollama", so re-adding an out-of-scope adapter to the
   * dropdown fails here instead of shipping.
   */
  test('lists exactly the two v1 providers and offers no out-of-scope adapter', () => {
    render(<AiSettingsSection />);
    const select = screen.getByRole('combobox', { name: 'Provider' });
    const optionLabels = Array.from(select.querySelectorAll('option')).map(
      (option) => option.textContent,
    );
    expect(optionLabels).toEqual(['Anthropic', 'Ollama (local)']);
    for (const banned of ['OpenAI', 'DeepSeek', 'Azure', 'Bedrock']) {
      expect(optionLabels.join(' ')).not.toContain(banned);
    }
  });

  test('hides the API key field entirely for Ollama — it needs no credential', async () => {
    const user = userEvent.setup();
    render(<AiSettingsSection />);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Provider' }), 'ollama');

    await waitFor(() => {
      expect(screen.queryByLabelText('API key')).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText('Ollama address')).toBeInTheDocument();
  });

  /**
   * The generic "Base URL" field existed only to configure the removed
   * out-of-scope adapter. Ollama keeps its own clearly-named "Ollama
   * address" field; no provider should surface a bare "Base URL".
   */
  test('offers no generic base URL field for either v1 provider', async () => {
    const user = userEvent.setup();
    render(<AiSettingsSection />);

    expect(screen.queryByLabelText('Base URL')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Provider' }), 'ollama');
    await waitFor(() => {
      expect(screen.getByLabelText('Ollama address')).toBeInTheDocument();
    });
    expect(screen.queryByLabelText('Base URL')).not.toBeInTheDocument();
  });

  test('saving a key stores it and shows the already-stored hint, without ever displaying the key value anywhere', async () => {
    const user = userEvent.setup();
    render(<AiSettingsSection />);

    const keyInput = screen.getByLabelText('API key');
    await user.type(keyInput, 'sk-ant-secret-value-do-not-leak-0000');
    await user.click(screen.getByRole('button', { name: 'Save key' }));

    await waitFor(() => {
      expect(screen.getByText('A key is already stored for this provider.')).toBeInTheDocument();
    });
    // The field clears after a successful save — the key is never echoed
    // back or left sitting in the DOM (Section 12: never in an IPC
    // response, and this component never persists it as anything beyond
    // the momentary controlled-input value).
    expect(screen.getByLabelText('API key')).toHaveValue('');
    expect(screen.queryByText('sk-ant-secret-value-do-not-leak-0000')).not.toBeInTheDocument();
  });

  test('clearing a stored key removes the already-stored hint', async () => {
    const user = userEvent.setup();
    await useSettingsStore.getState().storeAiKey('anthropic', 'sk-ant-clear-me-0000000000000');
    render(<AiSettingsSection />);

    expect(screen.getByText('A key is already stored for this provider.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear key' }));

    await waitFor(() => {
      expect(
        screen.queryByText('A key is already stored for this provider.'),
      ).not.toBeInTheDocument();
    });
  });
});
