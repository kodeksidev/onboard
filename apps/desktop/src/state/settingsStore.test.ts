import { afterEach, describe, expect, test } from 'vitest';
import { DEFAULT_SETTINGS } from '@/ipc/settings-schema';
import { useSettingsStore } from './settingsStore';

afterEach(() => {
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, isLoaded: false });
});

describe('settingsStore', () => {
  test('defaults to static mode with AI disabled (A5)', () => {
    expect(useSettingsStore.getState().settings.ai.isEnabled).toBe(false);
  });

  test('loadSettings fetches and zod-validates settings from the IPC layer', async () => {
    await useSettingsStore.getState().loadSettings();
    const state = useSettingsStore.getState();
    expect(state.isLoaded).toBe(true);
    expect(state.settings.settingsVersion).toBe(1);
  });

  test('updateSettings persists a patch and re-validates the response', async () => {
    await useSettingsStore.getState().updateSettings({ theme: 'dark' });
    expect(useSettingsStore.getState().settings.theme).toBe('dark');
  });
});
