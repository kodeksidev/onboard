//! `get_settings` / `update_settings` / `store_ai_key` / `clear_ai_key`
//! (Section 7.4, Section 6.2). Settings persist as plain JSON at
//! `<appConfigDir>/onboard/settings.json`; the AI API key is never part of
//! that file — `ai.hasStoredKey` is always recomputed live from the
//! keychain (or session-only store) rather than trusted from disk.

use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::error::{AppError, AppErrorCode};
use crate::secrets::ai_key::{AiKey, AiKeyStore, StoreOutcome};

pub const SETTINGS_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiProvider {
    Anthropic,
    Ollama,
}

impl AiProvider {
    /// The stable string key this provider is stored/looked-up under in
    /// the OS keychain (`secrets::ai_key`, Section 6.2's convention).
    /// Single source of truth — `ai::permit::acquire` and the (Phase 12
    /// step 3) provider adapters all call this instead of each keeping
    /// their own copy of the match.
    pub fn key_str(self) -> &'static str {
        match self {
            AiProvider::Anthropic => "anthropic",
            AiProvider::Ollama => "ollama",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentRepo {
    pub display_name: String,
    pub path: String,
    pub last_opened_iso: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    pub is_enabled: bool,
    pub provider: AiProvider,
    pub model: String,
    pub ollama_base_url: String,
    pub has_stored_key: bool,
}

impl Default for AiSettings {
    fn default() -> Self {
        AiSettings {
            is_enabled: false,
            provider: AiProvider::Anthropic,
            model: "claude-sonnet-4-5".to_string(),
            ollama_base_url: "http://127.0.0.1:11434".to_string(),
            has_stored_key: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub settings_version: u32,
    pub recent_repos: Vec<RecentRepo>,
    pub exclude_globs: Vec<String>,
    pub theme: Theme,
    pub ai: AiSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            settings_version: SETTINGS_VERSION,
            recent_repos: vec![],
            exclude_globs: vec![],
            theme: Theme::System,
            ai: AiSettings::default(),
        }
    }
}

/// `Partial<Settings>` (Section 7.4's `update_settings` request): every
/// field optional so only the fields the caller supplied are merged.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub recent_repos: Option<Vec<RecentRepo>>,
    pub exclude_globs: Option<Vec<String>>,
    pub theme: Option<Theme>,
    pub ai: Option<AiSettingsPatch>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsPatch {
    pub is_enabled: Option<bool>,
    pub provider: Option<AiProvider>,
    pub model: Option<String>,
    pub ollama_base_url: Option<String>,
}

fn read_settings_file(path: &Path) -> Settings {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Settings>(&text).ok())
        .unwrap_or_default()
}

fn write_settings_file(path: &Path, settings: &Settings) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| {
            AppError::invalid_settings(&format!("Could not create the settings directory: {err}"))
        })?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|err| {
        AppError::invalid_settings(&format!("Could not serialize settings: {err}"))
    })?;
    std::fs::write(path, json)
        .map_err(|err| AppError::invalid_settings(&format!("Could not write settings.json: {err}")))
}

/// Reads settings from disk, overwriting `ai.hasStoredKey` with the live
/// keychain/session-only truth (Section 6.2: never trust the mirror flag
/// on disk over the actual secret store).
pub fn get_settings_core(settings_path: &Path, ai_keys: &AiKeyStore) -> Settings {
    let mut settings = read_settings_file(settings_path);
    settings.ai.has_stored_key = ai_keys.has_key(settings.ai.provider.key_str());
    settings
}

/// A proof that the `AiSettings` inside came from the real, on-disk
/// settings store — not from a value a caller assembled in memory. `Debug`
/// and `Clone` are safe to derive (inspection and copying, not
/// construction); there is deliberately no `Deserialize`, no `Default`, no
/// `From<AiSettings>`, and the wrapped field is private, so the only way to
/// produce one anywhere in this crate is [`load_stored_ai_settings`] below.
///
/// This exists because `ai::endpoint::resolve` must never be callable with
/// a hand-built `AiSettings { ollama_base_url: "https://evil.example.com",
/// .. }` — see that module's doc comment for the full "WHERE it goes"
/// guarantee this type anchors. `tests/ai_endpoint_compile_fail.rs` proves
/// the struct-literal and `From`/`Into` routes are both compile errors.
#[derive(Debug, Clone)]
pub struct StoredAiSettings(AiSettings);

impl StoredAiSettings {
    pub fn ai(&self) -> &AiSettings {
        &self.0
    }
}

/// The ONLY function in this crate that produces a [`StoredAiSettings`].
/// Reads fresh from the real settings file via [`get_settings_core`] (which
/// also recomputes `hasStoredKey` from the real keychain) — never from a
/// caller-supplied `AiSettings`.
pub fn load_stored_ai_settings(settings_path: &Path, ai_keys: &AiKeyStore) -> StoredAiSettings {
    StoredAiSettings(get_settings_core(settings_path, ai_keys).ai)
}

fn apply_patch(current: Settings, patch: SettingsPatch) -> Settings {
    Settings {
        settings_version: SETTINGS_VERSION,
        recent_repos: patch.recent_repos.unwrap_or(current.recent_repos),
        exclude_globs: patch.exclude_globs.unwrap_or(current.exclude_globs),
        theme: patch.theme.unwrap_or(current.theme),
        ai: match patch.ai {
            None => current.ai,
            Some(ai_patch) => AiSettings {
                is_enabled: ai_patch.is_enabled.unwrap_or(current.ai.is_enabled),
                provider: ai_patch.provider.unwrap_or(current.ai.provider),
                model: ai_patch.model.unwrap_or(current.ai.model),
                ollama_base_url: ai_patch
                    .ollama_base_url
                    .unwrap_or(current.ai.ollama_base_url),
                has_stored_key: current.ai.has_stored_key,
            },
        },
    }
}

pub fn update_settings_core(
    settings_path: &Path,
    ai_keys: &AiKeyStore,
    patch: SettingsPatch,
) -> Result<Settings, AppError> {
    let current = get_settings_core(settings_path, ai_keys);
    let updated = apply_patch(current, patch);
    write_settings_file(settings_path, &updated)?;
    Ok(get_settings_core(settings_path, ai_keys))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreAiKeyResponse {
    pub is_stored: bool,
    pub is_session_only: bool,
}

impl From<StoreOutcome> for StoreAiKeyResponse {
    fn from(outcome: StoreOutcome) -> Self {
        StoreAiKeyResponse {
            is_stored: outcome.is_stored,
            is_session_only: outcome.is_session_only,
        }
    }
}

pub fn store_ai_key_core(
    ai_keys: &AiKeyStore,
    provider: &str,
    api_key: &str,
) -> Result<StoreAiKeyResponse, AppError> {
    let key = AiKey::parse(api_key)?;
    let outcome = ai_keys.store(provider, &key)?;
    Ok(outcome.into())
}

pub fn clear_ai_key_core(ai_keys: &AiKeyStore, provider: &str) -> Result<(), AppError> {
    ai_keys.clear(provider)
}

/// Validated so a caller cannot pass an arbitrary string as `provider`
/// beyond the two v1 adapters (A4).
pub fn validate_provider(provider: &str) -> Result<(), AppError> {
    if provider == "anthropic" || provider == "ollama" {
        Ok(())
    } else {
        Err(AppError::new(
            AppErrorCode::EInvalidSettings,
            format!("Unknown AI provider '{provider}'."),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_the_section_6_2_example() {
        let settings = Settings::default();
        assert_eq!(settings.settings_version, 1);
        assert!(!settings.ai.is_enabled);
        assert!(!settings.ai.has_stored_key);
        assert_eq!(settings.ai.ollama_base_url, "http://127.0.0.1:11434");
    }

    #[test]
    fn round_trips_through_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let ai_keys = AiKeyStore::new();

        let patch = SettingsPatch {
            theme: Some(Theme::Dark),
            exclude_globs: Some(vec!["**/*.snap".to_string()]),
            ..Default::default()
        };
        let updated = update_settings_core(&path, &ai_keys, patch).unwrap();
        assert!(matches!(updated.theme, Theme::Dark));

        let reloaded = get_settings_core(&path, &ai_keys);
        assert!(matches!(reloaded.theme, Theme::Dark));
        assert_eq!(reloaded.exclude_globs, vec!["**/*.snap".to_string()]);
    }

    #[test]
    fn a_missing_settings_file_returns_defaults_rather_than_erroring() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("does-not-exist.json");
        let ai_keys = AiKeyStore::new();

        let settings = get_settings_core(&path, &ai_keys);
        assert_eq!(settings.settings_version, 1);
    }

    /// Holds `secrets::ai_key::REAL_KEYCHAIN_TEST_LOCK` — this test asserts
    /// no REAL key exists right now for the real `"anthropic"` keychain
    /// account, which only holds if no other concurrently-running test has
    /// temporarily stored one there; see that lock's doc comment.
    #[test]
    fn has_stored_key_is_always_recomputed_from_the_key_store_not_disk() {
        let _lock = crate::secrets::ai_key::REAL_KEYCHAIN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        // Write a settings file that LIES about having a stored key.
        std::fs::write(
            &path,
            r#"{"settingsVersion":1,"recentRepos":[],"excludeGlobs":[],"theme":"system",
                "ai":{"isEnabled":true,"provider":"anthropic","model":"x",
                      "ollamaBaseUrl":"http://127.0.0.1:11434","hasStoredKey":true}}"#,
        )
        .unwrap();

        let ai_keys = AiKeyStore::new();
        let settings = get_settings_core(&path, &ai_keys);
        assert!(!settings.ai.has_stored_key);
    }

    #[test]
    fn validate_provider_rejects_anything_outside_the_two_v1_adapters() {
        assert!(validate_provider("anthropic").is_ok());
        assert!(validate_provider("ollama").is_ok());
        assert!(validate_provider("openai").is_err());
    }

    #[test]
    fn store_ai_key_core_rejects_a_too_short_key() {
        let ai_keys = AiKeyStore::new();
        let result = store_ai_key_core(&ai_keys, "anthropic", "short");
        assert!(result.is_err());
    }
}
