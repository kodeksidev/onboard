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

/// Wire form is `"anthropic"` / `"ollama"`, pinned by
/// `ai_provider_serializes_to_exactly_these_bytes` below and mirrored on the
/// TS side by `settings-schema.test.ts`.
///
/// This is `"lowercase"` rather than `"kebab-case"` because `"kebab-case"`
/// was only ever adopted to spell an out-of-scope third variant
/// (`OpenAiCompatible` -> `"openai-compatible"`); with that variant deleted,
/// both rules produce identical bytes for these two single-word names, and
/// the spec's own value is `"lowercase"`. See the SUPERSEDED markers on the
/// two step-3B/step-5 entries in `docs/DECISIONS.md`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiProvider {
    Anthropic,
    Ollama,
}

impl AiProvider {
    /// The stable string key this provider is stored/looked-up under in
    /// the OS keychain (`secrets::ai_key`, Section 6.2's convention).
    /// Single source of truth — `ai::permit::acquire` and the Phase 12
    /// step 3 provider adapters all call this instead of each keeping
    /// their own copy of the match.
    pub fn key_str(self) -> &'static str {
        match self {
            AiProvider::Anthropic => "anthropic",
            AiProvider::Ollama => "ollama",
        }
    }

    /// Whether THIS provider needs a stored credential at all before AI can
    /// be considered "on" for it (Phase 12 step 5, owner's ruling). The
    /// single, provider-aware answer `ai::permit::acquire` consults — not
    /// "AI on + key always," but "AI on + the credentials THIS provider
    /// requires." Anthropic is a cloud API and needs
    /// one; Ollama is local and unauthenticated by default, so gating it
    /// behind a key that is never transmitted (see
    /// `ai::ollama`'s doc comment) would be backwards. This is the ONE
    /// place that answers the question — `acquire` has no second,
    /// provider-conditional branch of its own; it just asks this.
    pub fn requires_stored_key(self) -> bool {
        match self {
            AiProvider::Anthropic => true,
            AiProvider::Ollama => false,
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
/// beyond the two v1 adapters (A4: "v1 ships exactly two AI adapters:
/// Anthropic and Ollama"; non-goal #2 names DeepSeek/OpenAI/Azure/Bedrock
/// and any other adapter explicitly). `openai-compatible` was built here in
/// violation of both and has been removed — see `docs/V2_BACKLOG.md`.
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
        // A DIFFERENT test's cleanup (a real keychain `clear()`, run when
        // that test's own lock-holding guard drops) can still be settling
        // on the OS side when this test acquires the lock immediately
        // after — the delete-visibility mirror of the write-visibility
        // race `eventually` already exists for; see that function's doc
        // comment. A one-shot check here was observed to flake exactly
        // this way once enough real-keychain-touching tests existed.
        assert!(crate::secrets::ai_key::eventually(|| {
            !get_settings_core(&path, &ai_keys).ai.has_stored_key
        }));
    }

    /// Pins the SERIALIZED BYTES of every `AiProvider` variant.
    ///
    /// This test exists because its absence is what let the wire
    /// representation drift for a reason unrelated to the wire: the
    /// `rename_all` attribute was switched from `"lowercase"` to
    /// `"kebab-case"` purely to spell an out-of-scope third variant, and
    /// nothing anywhere asserted what bytes reached `settings.json`. A
    /// `#[serde(rename_all = ...)]` change is invisible to every test that
    /// only round-trips a value through serde, because both directions move
    /// together — the only way to catch it is to assert the literal text.
    ///
    /// Both directions are pinned: the exact bytes out, and the exact bytes
    /// in (so a settings file written by any prior version still loads).
    #[test]
    fn ai_provider_serializes_to_exactly_these_bytes() {
        for (variant, expected) in [
            (AiProvider::Anthropic, "\"anthropic\""),
            (AiProvider::Ollama, "\"ollama\""),
        ] {
            let encoded = serde_json::to_string(&variant).expect("must serialize");
            assert_eq!(
                encoded, expected,
                "AiProvider's wire form is a compatibility surface: it is what \
                 lands in settings.json and what the TS AiProvider zod enum \
                 parses. Changing it silently breaks every existing settings file."
            );
            let decoded: AiProvider = serde_json::from_str(expected).expect("must deserialize");
            assert_eq!(decoded, variant);
        }
    }

    /// The variant set itself, pinned as bytes. Complements
    /// `validate_provider_rejects_anything_outside_the_two_v1_adapters`:
    /// that one guards the string validator, this one guards the enum a
    /// future contributor would have to edit to add an adapter.
    #[test]
    fn ai_provider_has_exactly_two_variants_on_the_wire() {
        let all = [AiProvider::Anthropic, AiProvider::Ollama];
        let encoded: Vec<String> = all
            .iter()
            .map(|v| serde_json::to_string(v).expect("must serialize"))
            .collect();
        assert_eq!(encoded, vec!["\"anthropic\"", "\"ollama\""]);
        assert!(
            serde_json::from_str::<AiProvider>("\"openai-compatible\"").is_err(),
            "A4: v1 ships exactly Anthropic and Ollama"
        );
    }

    #[test]
    fn validate_provider_rejects_anything_outside_the_two_v1_adapters() {
        assert!(validate_provider("anthropic").is_ok());
        assert!(validate_provider("ollama").is_ok());
        // A4 / non-goal #2. Each of these was either shipped in violation
        // (`openai-compatible`) or is named explicitly in the non-goal.
        for banned in [
            "openai-compatible",
            "openai",
            "deepseek",
            "azure",
            "bedrock",
            "groq",
            "openrouter",
        ] {
            assert!(
                validate_provider(banned).is_err(),
                "provider {banned} must be rejected: v1 ships exactly Anthropic and Ollama (A4)"
            );
        }
    }

    /// A settings file written by the version that shipped the
    /// out-of-scope `openai-compatible` adapter must not break the app.
    /// The stale `openaiCompatibleBaseUrl` key is simply ignored (serde
    /// tolerates unknown fields), and the rest of the file loads intact.
    #[test]
    fn a_settings_file_carrying_the_removed_base_url_field_still_loads() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(
            &path,
            r#"{"settingsVersion":1,"recentRepos":[],"excludeGlobs":[],"theme":"dark",
                "ai":{"isEnabled":false,"provider":"ollama","model":"x",
                      "ollamaBaseUrl":"http://127.0.0.1:11434",
                      "openaiCompatibleBaseUrl":"https://api.deepseek.com",
                      "hasStoredKey":false}}"#,
        )
        .unwrap();
        let ai_keys = AiKeyStore::new();
        let settings = get_settings_core(&path, &ai_keys);
        assert!(matches!(settings.ai.provider, AiProvider::Ollama));
        assert_eq!(settings.ai.ollama_base_url, "http://127.0.0.1:11434");
        assert!(matches!(settings.theme, Theme::Dark));
    }

    /// The harder half of the same migration: a settings file whose stored
    /// `provider` IS the removed adapter. `AiProvider` no longer has that
    /// variant, so deserialization fails and `read_settings_file` falls back
    /// to `Settings::default()` — which has `isEnabled: false`. Fail-safe by
    /// construction: the one thing that must never happen is silently
    /// continuing to send snippets to a provider that no longer exists.
    #[test]
    fn a_settings_file_pinned_to_the_removed_provider_falls_back_to_ai_off() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(
            &path,
            r#"{"settingsVersion":1,"recentRepos":[],"excludeGlobs":[],"theme":"system",
                "ai":{"isEnabled":true,"provider":"openai-compatible","model":"x",
                      "ollamaBaseUrl":"http://127.0.0.1:11434","hasStoredKey":true}}"#,
        )
        .unwrap();
        let ai_keys = AiKeyStore::new();
        let settings = get_settings_core(&path, &ai_keys);
        assert!(!settings.ai.is_enabled, "AI must fall back to OFF");
        assert!(matches!(settings.ai.provider, AiProvider::Anthropic));
    }

    #[test]
    fn store_ai_key_core_rejects_a_too_short_key() {
        let ai_keys = AiKeyStore::new();
        let result = store_ai_key_core(&ai_keys, "anthropic", "short");
        assert!(result.is_err());
    }

    /// The literal proof for "never plaintext config": store a REAL key
    /// (via the real `store_ai_key_core` -> real keychain/session store),
    /// write real settings to a real file on disk with AI enabled for
    /// that provider, then read the RAW file BYTES back and assert the
    /// actual secret value is not a substring anywhere in them — not
    /// "the `AiSettings` struct has no key field" as a type-level
    /// argument, but the actual file content.
    #[test]
    fn the_stored_key_value_never_appears_in_the_settings_json_file_on_disk() {
        let _lock = crate::secrets::ai_key::REAL_KEYCHAIN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let ai_keys = AiKeyStore::new();
        let secret_value = "sk-ant-never-appear-in-settings-json-0000";
        struct Cleanup<'a> {
            store: &'a AiKeyStore,
        }
        impl Drop for Cleanup<'_> {
            fn drop(&mut self) {
                let _ = self.store.clear("anthropic");
            }
        }
        let _cleanup = Cleanup { store: &ai_keys };

        store_ai_key_core(&ai_keys, "anthropic", secret_value).expect("store must succeed");
        assert!(crate::secrets::ai_key::eventually(
            || ai_keys.has_key("anthropic")
        ));

        update_settings_core(
            &path,
            &ai_keys,
            SettingsPatch {
                ai: Some(AiSettingsPatch {
                    is_enabled: Some(true),
                    provider: Some(AiProvider::Anthropic),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )
        .expect("update_settings_core must succeed");

        let raw_file_bytes = std::fs::read_to_string(&path).expect("settings.json must exist");
        assert!(
            !raw_file_bytes.contains(secret_value),
            "the raw secret value leaked into settings.json: {raw_file_bytes}"
        );
        // Sanity: the file DOES reflect that a key exists, just never the
        // value itself. `to_string_pretty` inserts a space after `:`, so
        // this checks the key name and `true` are both present rather
        // than assuming exact compact-JSON spacing.
        assert!(raw_file_bytes.contains("hasStoredKey"));
        assert!(raw_file_bytes.contains("true"));
    }
}
