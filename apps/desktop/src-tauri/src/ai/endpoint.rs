//! `ai/endpoint.rs` — the WHERE half of Section 12's egress guarantee.
//!
//! The triad, all enforced at compile time:
//!
//! - **WHAT** leaves → [`crate::privacy::redact::RedactedPayload`] (redacted
//!   only)
//! - **WHETHER** it may → [`crate::ai::permit::EgressPermit`] (AI on + a
//!   real stored key, or it doesn't exist)
//! - **WHERE** it goes → [`ResolvedEndpoint`] (built from the real,
//!   on-disk settings store — never from a caller-supplied value)
//!
//! ## Why `endpoint: &str` on `send` was wrong, and what replaces it
//!
//! A free `&str`/`String` parameter lets ANY caller point the one HTTP
//! client in the crate at ANY host — the permit only proves AI is *on*, not
//! that the target is a legitimate provider endpoint. [`ResolvedEndpoint`]
//! closes that gap the same structural way `RedactedPayload` and
//! `EgressPermit` closed theirs: a private field, no public constructor of
//! any kind (no `new`, no `Default`, no `Deserialize`, no `From<String>`/
//! `From<&str>`) — the only place `ResolvedEndpoint { .. }` is written is
//! inside [`resolve`], right here. `send` takes `&ResolvedEndpoint`, not
//! `&str`, so a caller without a resolved endpoint has no way to call it —
//! `tests/ai_endpoint_compile_fail.rs` proves every one of those routes
//! from an external crate, plus the old `send(.., "https://...", ..)`
//! call shape itself.
//!
//! ## Why `resolve` takes `&StoredAiSettings`, not `&AiSettings`
//!
//! `AiSettings` is a `Deserialize`-deriving DTO — any module can build one
//! in memory, including `AiSettings { ollama_base_url:
//! "https://evil.example.com", .. }`. If `resolve` accepted that directly,
//! the guarantee would be worthless: an attacker just hands it settings
//! that point wherever they like, and the type system would "bless" it
//! anyway. [`crate::commands::settings::StoredAiSettings`] closes this the
//! same way — private field, no public constructor except
//! [`crate::commands::settings::load_stored_ai_settings`], which reads
//! fresh from the real settings file. A caller holding a hand-built
//! `AiSettings` cannot manufacture a `StoredAiSettings` to feed `resolve`
//! (see that type's own doc comment, and
//! `a_fabricated_ai_settings_cannot_steer_the_resolved_url` below for the
//! runtime half of this proof: the resolved URL always reflects what is
//! actually on disk).
//!
//! ## Provider URLs
//!
//! Anthropic's endpoint is a fixed constant — Section 4 names it, and it is
//! not user-configurable. Ollama's is `{ollama_base_url}/api/chat` — that
//! `base_url` is user-configurable (Section 6.2) but only ever read from
//! the stored settings, never a call-site
//! argument, and is validated (non-empty, `http://`/
//! `https://`) before use.

use crate::commands::settings::{AiProvider, StoredAiSettings};
use crate::error::AppError;

/// Section 4 / the prompt spec: the fixed Anthropic Messages API endpoint.
/// Not user-configurable — Anthropic has one canonical host.
pub const ANTHROPIC_MESSAGES_URL: &str = "https://api.anthropic.com/v1/messages";

/// A fully-resolved, safe-to-call HTTP endpoint. The private field and
/// total absence of a public constructor (no `new`, no `Default`, no
/// `Deserialize`, no `From<String>`/`From<&str>`) mean the only way to
/// obtain one is [`resolve`] — see this module's doc comment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedEndpoint {
    url: String,
}

impl ResolvedEndpoint {
    pub fn url(&self) -> &str {
        &self.url
    }
}

/// A `#[cfg(test)]`-only second construction site — the "safest shape" for
/// letting the real-bytes redaction test (Phase 12 step 3A) point an
/// adapter at a local `TcpListener` instead of the fixed Anthropic
/// constant. Because the whole function is compiled out of every
/// non-test build (`cargo build`, `cargo run`, every packaged installer),
/// there is no runtime toggle, settings field, or caller argument that
/// reaches it in a release binary — not "disabled by default," genuinely
/// absent from the compiled artifact. `ResolvedEndpoint { .. }` still only
/// ever appears in this one file, in exactly these two functions.
#[cfg(test)]
pub(crate) fn resolve_for_test(url: impl Into<String>) -> ResolvedEndpoint {
    ResolvedEndpoint { url: url.into() }
}

/// The only production-reachable place `ResolvedEndpoint { .. }` is
/// constructed. Builds the target URL from `stored` — which can only have
/// come from the real settings file (see [`StoredAiSettings`]) — never
/// from a caller argument.
pub fn resolve(stored: &StoredAiSettings) -> Result<ResolvedEndpoint, AppError> {
    let settings = stored.ai();
    match settings.provider {
        AiProvider::Anthropic => Ok(ResolvedEndpoint {
            url: ANTHROPIC_MESSAGES_URL.to_string(),
        }),
        AiProvider::Ollama => {
            let base = validate_http_base_url(&settings.ollama_base_url, "Ollama")?;
            Ok(ResolvedEndpoint {
                url: format!("{base}/api/chat"),
            })
        }
    }
}

/// Shared validation for every user-configurable `base_url` — non-empty,
/// `http://`/`https://`, trailing slash trimmed. `label` names the setting
/// in the error message (never the raw value's provenance — that's already
/// clear from context).
fn validate_http_base_url<'a>(base_url: &'a str, label: &str) -> Result<&'a str, AppError> {
    let base = base_url.trim();
    let is_valid_http_url = base.starts_with("http://") || base.starts_with("https://");
    if base.is_empty() || !is_valid_http_url {
        return Err(AppError::invalid_settings(&format!(
            "The configured {label} address '{base}' is not a valid http(s) URL."
        )));
    }
    Ok(base.trim_end_matches('/'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::settings::{
        load_stored_ai_settings, update_settings_core, AiSettings, AiSettingsPatch, SettingsPatch,
    };
    use crate::secrets::ai_key::AiKeyStore;

    #[test]
    fn anthropic_resolves_to_the_fixed_constant_regardless_of_ollama_base_url() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let ai_keys = AiKeyStore::new();
        update_settings_core(
            &path,
            &ai_keys,
            SettingsPatch {
                ai: Some(AiSettingsPatch {
                    provider: Some(AiProvider::Anthropic),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )
        .unwrap();

        let stored = load_stored_ai_settings(&path, &ai_keys);
        let resolved = resolve(&stored).unwrap();
        assert_eq!(resolved.url(), ANTHROPIC_MESSAGES_URL);
    }

    #[test]
    fn ollama_resolves_from_the_real_stored_base_url() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let ai_keys = AiKeyStore::new();
        update_settings_core(
            &path,
            &ai_keys,
            SettingsPatch {
                ai: Some(AiSettingsPatch {
                    provider: Some(AiProvider::Ollama),
                    ollama_base_url: Some("http://10.0.0.5:11434".to_string()),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )
        .unwrap();

        let stored = load_stored_ai_settings(&path, &ai_keys);
        let resolved = resolve(&stored).unwrap();
        assert_eq!(resolved.url(), "http://10.0.0.5:11434/api/chat");
    }

    #[test]
    fn a_malformed_stored_ollama_base_url_is_rejected_not_silently_used() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let ai_keys = AiKeyStore::new();
        update_settings_core(
            &path,
            &ai_keys,
            SettingsPatch {
                ai: Some(AiSettingsPatch {
                    provider: Some(AiProvider::Ollama),
                    ollama_base_url: Some("not-a-url".to_string()),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )
        .unwrap();

        let stored = load_stored_ai_settings(&path, &ai_keys);
        let result = resolve(&stored);
        assert_eq!(result.unwrap_err().code, "E_INVALID_SETTINGS");
    }


    /// The runtime half of "a caller-fabricated `AiSettings` with an
    /// attacker-controlled `base_url` must not produce a `ResolvedEndpoint`
    /// pointing at that host." The compile-time half
    /// (`tests/ai_endpoint_compile_fail.rs`) proves `resolve` has no
    /// signature that even ACCEPTS a bare `AiSettings` or a hand-built
    /// `StoredAiSettings` — there is no call site for `fabricated` to reach
    /// `resolve` through at all. This proves the complementary fact: the
    /// URL `resolve` actually returns, for the REAL on-disk settings,
    /// never contains the attacker's host, and always matches what is
    /// really stored.
    #[test]
    fn a_fabricated_ai_settings_cannot_steer_the_resolved_url() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let ai_keys = AiKeyStore::new();
        update_settings_core(
            &path,
            &ai_keys,
            SettingsPatch {
                ai: Some(AiSettingsPatch {
                    provider: Some(AiProvider::Ollama),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )
        .unwrap();

        let fabricated = AiSettings {
            is_enabled: true,
            provider: AiProvider::Ollama,
            model: "x".to_string(),
            ollama_base_url: "https://evil.example.com".to_string(),
            has_stored_key: false,
        };

        let stored = load_stored_ai_settings(&path, &ai_keys);
        assert_ne!(
            fabricated.ollama_base_url,
            stored.ai().ollama_base_url,
            "sanity: the fabricated value really does claim a different host"
        );

        let resolved = resolve(&stored).unwrap();
        assert!(resolved.url().starts_with("http://127.0.0.1:11434"));
        assert!(!resolved.url().contains("evil.example.com"));
    }
}
