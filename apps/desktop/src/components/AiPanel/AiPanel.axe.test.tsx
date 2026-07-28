import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { AnalysisEnvelope } from '@onboard/contract';
import type { AnalysisResult } from '@onboard/contract';
import rawSampleAnalysis from '@onboard/contract/fixtures/sample-analysis.json';
import { AiPanel } from './AiPanel';
import { ipc } from '@/ipc/ipc';
import { DEFAULT_SETTINGS } from '@/ipc/settings-schema';
import { useAiStore } from '@/state/aiStore';
import { useSettingsStore } from '@/state/settingsStore';
import { SLOW_MOUNT_TIMEOUT_MS } from '@/test/timeouts';

const RESULT: AnalysisResult = AnalysisEnvelope.parse(rawSampleAnalysis).result;

/** Enabled through the same mock IPC the app uses, so the mock's own AI gate is satisfied too. */
async function enableAi(): Promise<void> {
  await ipc.storeAiKey({ provider: 'anthropic', apiKey: 'sk-test-key' });
  await ipc.updateSettings({ ai: { ...DEFAULT_SETTINGS.ai, isEnabled: true, hasStoredKey: true } });
  await useSettingsStore.getState().loadSettings();
}

afterEach(async () => {
  await ipc.updateSettings({ ai: DEFAULT_SETTINGS.ai });
  await ipc.clearAiKey({ provider: 'anthropic' });
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, isLoaded: false, isSettingsOpen: false });
  useAiStore.getState().reset();
});

describe('AiPanel accessibility', { timeout: SLOW_MOUNT_TIMEOUT_MS }, () => {
  test('has zero axe-core violations in the "AI is off" state', async () => {
    const { container } = render(<AiPanel result={RESULT} onOpenFile={vi.fn()} />);

    const results = await axe(container);

    expect(results.violations).toEqual([]);
  });

  test('has zero axe-core violations with all three action panels mounted', async () => {
    await enableAi();
    const { container } = render(<AiPanel result={RESULT} onOpenFile={vi.fn()} />);

    const results = await axe(container);

    expect(results.violations).toEqual([]);
  });

  test('has zero axe-core violations once an answer with citations is on screen', async () => {
    const user = userEvent.setup();
    await enableAi();
    const { container } = render(<AiPanel result={RESULT} onOpenFile={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Summarise this project' }));
    await screen.findByRole('heading', { name: 'What this project is' });
    const results = await axe(container);

    expect(results.violations).toEqual([]);
  });
});
