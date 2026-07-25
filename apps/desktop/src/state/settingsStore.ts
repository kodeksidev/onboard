import { create } from 'zustand';
import { ipc } from '@/ipc/ipc';
import { DEFAULT_SETTINGS, Settings } from '@/ipc/settings-schema';
import type { SettingsPatch } from '@/ipc/settings-schema';

export interface SettingsState {
  readonly settings: Settings;
  readonly isLoaded: boolean;
  loadSettings: () => Promise<void>;
  updateSettings: (patch: SettingsPatch) => Promise<void>;
}

/**
 * Mirrors `repoStore`'s contract-drift guard for the settings boundary
 * (Section 12): `get_settings` / `update_settings` responses are re-parsed
 * with `Settings` before they ever reach a component.
 */
export const useSettingsStore = create<SettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  isLoaded: false,

  loadSettings: async () => {
    const raw = await ipc.getSettings();
    set({ settings: Settings.parse(raw), isLoaded: true });
  },

  updateSettings: async (patch: SettingsPatch) => {
    const raw = await ipc.updateSettings(patch);
    set({ settings: Settings.parse(raw) });
  },
}));
