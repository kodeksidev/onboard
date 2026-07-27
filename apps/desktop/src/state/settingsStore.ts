import { create } from 'zustand';
import { ipc } from '@/ipc/ipc';
import type { AiProviderName, TestAiKeyResult } from '@/ipc/ipc';
import { DEFAULT_SETTINGS, Settings } from '@/ipc/settings-schema';
import type { SettingsPatch } from '@/ipc/settings-schema';

export interface SettingsState {
  readonly settings: Settings;
  readonly isLoaded: boolean;
  loadSettings: () => Promise<void>;
  updateSettings: (patch: SettingsPatch) => Promise<void>;
  /**
   * Section 7.4's `store_ai_key` response is `{ isStored, isSessionOnly }`,
   * not a full `Settings` — `hasStoredKey` is updated locally from
   * `isStored` rather than re-fetching (Section 12: the key itself never
   * comes back in any response, so there is nothing else to re-parse).
   */
  storeAiKey: (provider: AiProviderName, apiKey: string) => Promise<void>;
  clearAiKey: (provider: AiProviderName) => Promise<void>;
  /**
   * Deliberately does NOT touch `settings` — `test_ai_key` (Section 7.4)
   * is a stateless round trip through the real chokepoint
   * (`apps/desktop/src-tauri/src/commands/ai.rs`'s doc comment), not a
   * settings mutation. Callers (`TestKeyButton`) hold the pass/fail result
   * in local component state.
   */
  testAiKey: (provider: AiProviderName, model: string) => Promise<TestAiKeyResult>;
}

/**
 * Mirrors `repoStore`'s contract-drift guard for the settings boundary
 * (Section 12): `get_settings` / `update_settings` responses are re-parsed
 * with `Settings` before they ever reach a component.
 */
export const useSettingsStore = create<SettingsState>((set, get) => ({
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

  storeAiKey: async (provider, apiKey) => {
    const result = await ipc.storeAiKey({ provider, apiKey });
    const current = get().settings;
    set({ settings: { ...current, ai: { ...current.ai, hasStoredKey: result.isStored } } });
  },

  clearAiKey: async (provider) => {
    await ipc.clearAiKey({ provider });
    const current = get().settings;
    set({ settings: { ...current, ai: { ...current.ai, hasStoredKey: false } } });
  },

  testAiKey: (provider, model) => ipc.testAiKey({ provider, model }),
}));
