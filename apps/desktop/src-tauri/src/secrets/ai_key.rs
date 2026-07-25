//! `AiKey` — a newtype whose `Debug`/`Display` render `<redacted>` (Section
//! 12), so an accidental `println!("{:?}", key)` or a `.to_string()` inside
//! a log line is harmless, plus `AiKeyStore`, which persists a key to the
//! OS keychain and transparently falls back to a session-only in-memory
//! map when no OS secret store is available (A18: the key is NEVER written
//! to disk in that case).

use std::collections::HashMap;
use std::fmt;
use std::sync::Mutex;

use crate::constants::{AI_KEY_MAX_LEN, AI_KEY_MIN_LEN};
use crate::error::{AppError, AppErrorCode};
use crate::secrets::keychain::{self, Keychain};

pub struct AiKey(String);

impl AiKey {
    pub fn parse(raw: &str) -> Result<Self, AppError> {
        if raw.len() < AI_KEY_MIN_LEN || raw.len() > AI_KEY_MAX_LEN {
            return Err(AppError::new(
                AppErrorCode::EInvalidSettings,
                format!(
                    "API keys must be between {AI_KEY_MIN_LEN} and {AI_KEY_MAX_LEN} characters."
                ),
            ));
        }
        Ok(AiKey(raw.to_string()))
    }

    fn reveal(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for AiKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "<redacted>")
    }
}

impl fmt::Display for AiKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "<redacted>")
    }
}

/// Outcome of `AiKeyStore::store`, matching the `store_ai_key` command's
/// `{ isStored, isSessionOnly }` response shape (Section 7.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StoreOutcome {
    pub is_stored: bool,
    pub is_session_only: bool,
}

/// Session-only fallback storage: a plain in-memory map, dropped when the
/// process exits. Never serialized, never written to a file.
#[derive(Default)]
struct SessionKeys {
    keys: Mutex<HashMap<String, String>>,
}

pub struct AiKeyStore {
    session: SessionKeys,
}

impl Default for AiKeyStore {
    fn default() -> Self {
        Self::new()
    }
}

impl AiKeyStore {
    pub fn new() -> Self {
        AiKeyStore {
            session: SessionKeys::default(),
        }
    }

    /// Stores `key` for `provider`. Tries the OS keychain first; if the
    /// backend itself is unavailable (A18), falls back to the session-only
    /// map instead of failing the whole request.
    pub fn store(&self, provider: &str, key: &AiKey) -> Result<StoreOutcome, AppError> {
        let account = keychain::account_for(provider);
        match Keychain::set(&account, key.reveal()) {
            Ok(()) => Ok(StoreOutcome {
                is_stored: true,
                is_session_only: false,
            }),
            Err(err) if keychain::is_backend_unavailable(&err) => {
                self.session
                    .keys
                    .lock()
                    .expect("session key map poisoned")
                    .insert(account, key.reveal().to_string());
                Ok(StoreOutcome {
                    is_stored: true,
                    is_session_only: true,
                })
            }
            Err(_) => Err(AppError::keychain_unavailable()),
        }
    }

    pub fn clear(&self, provider: &str) -> Result<(), AppError> {
        let account = keychain::account_for(provider);
        self.session
            .keys
            .lock()
            .expect("session key map poisoned")
            .remove(&account);
        match Keychain::delete(&account) {
            Ok(()) => Ok(()),
            Err(err) if keychain::is_backend_unavailable(&err) => Ok(()),
            Err(_) => Err(AppError::keychain_unavailable()),
        }
    }

    /// True when a key is retrievable for `provider`, from either the
    /// keychain or the session-only fallback. Used by `get_settings` to
    /// populate `hasStoredKey` and by the (Phase 12) `ai_*` gating check —
    /// never returns the key itself.
    pub fn has_key(&self, provider: &str) -> bool {
        let account = keychain::account_for(provider);
        if self
            .session
            .keys
            .lock()
            .expect("session key map poisoned")
            .contains_key(&account)
        {
            return true;
        }
        matches!(Keychain::get(&account), Ok(Some(_)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_and_display_never_reveal_the_raw_key() {
        let key = AiKey::parse("REDACTED-ANTHROPIC-BY-HISTORY-REWRITE").unwrap();
        assert_eq!(format!("{key:?}"), "<redacted>");
        assert_eq!(format!("{key}"), "<redacted>");
    }

    #[test]
    fn parse_rejects_a_key_shorter_than_the_minimum() {
        let result = AiKey::parse("short");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code, "E_INVALID_SETTINGS");
    }

    #[test]
    fn parse_rejects_a_key_longer_than_the_maximum() {
        let too_long = "a".repeat(AI_KEY_MAX_LEN + 1);
        assert!(AiKey::parse(&too_long).is_err());
    }

    #[test]
    fn parse_accepts_a_key_within_bounds() {
        assert!(AiKey::parse("REDACTED-ANTHROPIC-BY-HISTORY-REWRITE").is_ok());
    }

    #[test]
    fn has_key_is_false_before_anything_is_stored_for_a_fresh_provider() {
        let store = AiKeyStore::new();
        assert!(!store.has_key("nonexistent-test-provider-xyz"));
    }

    /// Guarantees the real OS keychain entry this test creates is removed
    /// even if an assertion panics partway through — the gate requires
    /// "Keychain round-trip works" against the real backend, not a mock,
    /// so this test intentionally touches the OS credential store once.
    struct CleanupGuard<'a> {
        store: &'a AiKeyStore,
        provider: &'a str,
    }
    impl Drop for CleanupGuard<'_> {
        fn drop(&mut self) {
            let _ = self.store.clear(self.provider);
        }
    }

    #[test]
    fn stores_and_clears_a_real_round_trip_through_the_os_keychain() {
        let store = AiKeyStore::new();
        let provider = "onboard-phase6-keychain-roundtrip-test";
        let _cleanup = CleanupGuard {
            store: &store,
            provider,
        };

        let key = AiKey::parse("sk-ant-roundtrip-test-key-0000").unwrap();
        let outcome = store.store(provider, &key).expect("store must succeed");
        assert!(outcome.is_stored);
        assert!(store.has_key(provider));

        store.clear(provider).expect("clear must succeed");
        assert!(!store.has_key(provider));
    }
}
