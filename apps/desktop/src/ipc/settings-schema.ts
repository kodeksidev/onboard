import { z } from 'zod';

/**
 * Settings — Section 6.2. This shape lives in the Rust/config layer
 * (`<appConfigDir>/onboard/settings.json`, owned by `rust-tauri`), not in
 * the frozen `AnalysisResult` contract (Section 7), so it is not exported by
 * `@onboard/contract`. The UI still needs a runtime-validated type for
 * `get_settings` / `update_settings` (Section 7.4), and Section 12 requires
 * every payload crossing the webview boundary to be re-parsed rather than
 * trusted — so it is defined here, transcribed field-for-field from Section
 * 6.2's example, and re-parsed in `settingsStore` exactly like
 * `AnalysisEnvelope` is in `repoStore`.
 */
export const AiProvider = z.enum(['anthropic', 'ollama']);
export type AiProvider = z.infer<typeof AiProvider>;

export const AiSettings = z.object({
  isEnabled: z.boolean(),
  provider: AiProvider,
  model: z.string(),
  ollamaBaseUrl: z.string(),
  hasStoredKey: z.boolean(),
});
export type AiSettings = z.infer<typeof AiSettings>;

export const RecentRepo = z.object({
  displayName: z.string(),
  path: z.string(),
  lastOpenedIso: z.string(),
});
export type RecentRepo = z.infer<typeof RecentRepo>;

export const ThemePreference = z.enum(['system', 'light', 'dark']);
export type ThemePreference = z.infer<typeof ThemePreference>;

export const Settings = z.object({
  settingsVersion: z.literal(1),
  recentRepos: z.array(RecentRepo),
  excludeGlobs: z.array(z.string()),
  theme: ThemePreference,
  ai: AiSettings,
});
export type Settings = z.infer<typeof Settings>;

/** `update_settings` (Section 7.4): `Partial<Settings>` request, full `Settings` response. */
export type SettingsPatch = Partial<Settings>;

export const DEFAULT_SETTINGS: Settings = {
  settingsVersion: 1,
  recentRepos: [],
  excludeGlobs: [],
  theme: 'system',
  ai: {
    isEnabled: false,
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    hasStoredKey: false,
  },
};
