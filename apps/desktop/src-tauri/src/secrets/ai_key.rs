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

/// Serializes every test in this crate that touches the REAL OS keychain
/// backend (as opposed to this store's session-only in-memory fallback).
/// Found by direct observation, not theory: even tests using distinct,
/// per-test-unique provider names (so no two tests ever touch the same
/// keychain *account*) still intermittently failed under `cargo test`'s
/// default concurrent-by-default execution — e.g. a `store()` immediately
/// followed by a `has_key()` sanity check on the SAME provider, in the
/// SAME test, on the SAME `AiKeyStore` instance, spuriously observing
/// "not there." The OS keychain backend itself (Windows Credential
/// Manager / macOS Keychain / the Secret Service D-Bus daemon) is a
/// single, process/system-wide resource, and this crate's `keyring`
/// wrapper gives no isolation guarantee across concurrent callers from
/// many threads in one process — contention there, not a bug in any
/// individual test's logic. Every test anywhere in this crate that calls
/// `AiKeyStore::store`/`retrieve`/`clear` against the real backend (i.e.
/// not exercising the session-only fallback deliberately) must hold this
/// for its duration. `#[cfg(test)]`-only: does not exist in any non-test
/// build.
#[cfg(test)]
pub(crate) static REAL_KEYCHAIN_TEST_LOCK: Mutex<()> = Mutex::new(());

/// Even fully serialized behind [`REAL_KEYCHAIN_TEST_LOCK`], a `store()`
/// immediately followed by a `has_key()`/`retrieve()` on the SAME provider,
/// in the SAME test, on the SAME `AiKeyStore` instance, was still observed
/// to intermittently report "not there" under general system load (many
/// unrelated tests/threads/processes competing for CPU while `cargo test`
/// runs) — real OS keychain backends (confirmed on Windows Credential
/// Manager) do not guarantee a write (or a delete — the SAME class of
/// delay was independently observed on the read-after-clear side, once
/// this crate's real-keychain-touching test count grew enough under step
/// 5's three-provider suite) is immediately visible to the very next read
/// under load. Empirically, a 1s budget was NOT always enough under this
/// phase's full parallel `cargo test` load (confirmed via a diagnostic
/// probe: a real, still-present credential after the full 1s budget,
/// which a longer budget then resolved) — this polls `check` for up to
/// ~6s before giving up, which is a write/delete-visibility tolerance,
/// not a weakening of what's being tested — every test using it still
/// fails for real if the key genuinely never appears or never clears.
/// `#[cfg(test)]`-only.
#[cfg(test)]
pub(crate) fn eventually(check: impl Fn() -> bool) -> bool {
    for _ in 0..240 {
        if check() {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    false
}

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

    /// `pub(crate)`, not `pub`: legitimate same-crate callers (header
    /// construction in `ai::anthropic`, and this module's own `store`) need
    /// the raw value; nothing outside the crate can reach it, and `Debug`/
    /// `Display` above still always redact regardless of who calls this.
    pub(crate) fn reveal(&self) -> &str {
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

/// `Clone` is a cheap `Arc` clone sharing the SAME underlying session map —
/// not a fresh, empty one. `AppState` holds one instance for the whole
/// app's lifetime; the Phase 12 step 5 provider adapters
/// (`ai::anthropic`/`ai::ollama`) each take an
/// OWNED `AiKeyStore` in their constructor (so their tests can build
/// throwaway instances freely), so `commands::ai::test_ai_key_core` needs
/// to hand each one a `.clone()` of `state.ai_keys` — if that produced an
/// independent, empty session map instead, a key stored earlier via the
/// A18 session-only fallback (no OS keychain available) would silently
/// stop being visible to `test_ai_key`.
pub struct AiKeyStore {
    session: std::sync::Arc<SessionKeys>,
}

impl Clone for AiKeyStore {
    fn clone(&self) -> Self {
        AiKeyStore {
            session: self.session.clone(),
        }
    }
}

impl Default for AiKeyStore {
    fn default() -> Self {
        Self::new()
    }
}

impl AiKeyStore {
    pub fn new() -> Self {
        AiKeyStore {
            session: std::sync::Arc::new(SessionKeys::default()),
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

    /// Retrieves the real key for `provider` — session-only store first,
    /// then the OS keychain. Callers MUST already hold proof AI is usable
    /// (an `EgressPermit` — `ai::permit::acquire` already calls `has_key`
    /// internally) before calling this; it exists for exactly one
    /// legitimate purpose, building an outbound auth header in
    /// `ai::anthropic` (and `ollama`) — never
    /// logged, never put in `AppError.message` (the returned `AiKey`'s
    /// `Debug`/`Display` stay redacted regardless).
    pub fn retrieve(&self, provider: &str) -> Result<AiKey, AppError> {
        let account = keychain::account_for(provider);
        if let Some(value) = self
            .session
            .keys
            .lock()
            .expect("session key map poisoned")
            .get(&account)
            .cloned()
        {
            return Ok(AiKey(value));
        }
        match Keychain::get(&account) {
            Ok(Some(value)) => Ok(AiKey(value)),
            Ok(None) => Err(AppError::ai_disabled()),
            Err(err) if keychain::is_backend_unavailable(&err) => Err(AppError::ai_disabled()),
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
        let _lock = REAL_KEYCHAIN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let store = AiKeyStore::new();
        let provider = "onboard-phase6-keychain-roundtrip-test";
        let _cleanup = CleanupGuard {
            store: &store,
            provider,
        };

        let key = AiKey::parse("sk-ant-roundtrip-test-key-0000").unwrap();
        let outcome = store.store(provider, &key).expect("store must succeed");
        assert!(outcome.is_stored);
        assert!(eventually(|| store.has_key(provider)));

        store.clear(provider).expect("clear must succeed");
        assert!(eventually(|| !store.has_key(provider)));
    }

    #[test]
    fn retrieve_returns_the_real_value_that_was_stored() {
        let _lock = REAL_KEYCHAIN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let store = AiKeyStore::new();
        let provider = "onboard-phase12-step3a-retrieve-test";
        let _cleanup = CleanupGuard {
            store: &store,
            provider,
        };
        let key = AiKey::parse("sk-ant-retrieve-test-key-000000").unwrap();
        store.store(provider, &key).expect("store must succeed");
        assert!(eventually(|| store.has_key(provider)));

        let retrieved = store.retrieve(provider).expect("retrieve must succeed");
        assert_eq!(retrieved.reveal(), "sk-ant-retrieve-test-key-000000");
    }

    #[test]
    fn retrieve_fails_for_a_provider_with_no_stored_key() {
        let store = AiKeyStore::new();
        let result = store.retrieve("onboard-phase12-nonexistent-retrieve-test");
        assert!(result.is_err());
    }

    /// `commands::ai::test_ai_key_core`'s reason for existing:
    /// `AiKeyStore::clone()` must be a cheap handle to the SAME underlying
    /// state, not an independent, empty one — a key stored through one
    /// handle must be visible through a clone of it. (This exercises
    /// whichever backend `store` actually used on this machine — the real
    /// OS keychain here, since it is available in this test environment —
    /// so it does not, by itself, isolate the session-only-map-sharing
    /// half of the guarantee from the keychain-is-shared-system-wide-
    /// regardless-of-instance half; both are exercised together, which is
    /// the behavior that actually matters at the call site.)
    #[test]
    fn clone_shares_the_same_underlying_store_not_an_independent_one() {
        let _lock = REAL_KEYCHAIN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let store = AiKeyStore::new();
        let provider = "onboard-phase12-step5-clone-sharing-test";
        let _cleanup = CleanupGuard {
            store: &store,
            provider,
        };

        let cloned = store.clone();
        let key = AiKey::parse("sk-ant-clone-sharing-test-000000").unwrap();
        store.store(provider, &key).expect("store must succeed");
        assert!(eventually(|| cloned.has_key(provider)));

        let retrieved = cloned.retrieve(provider).expect("retrieve must succeed");
        assert_eq!(retrieved.reveal(), "sk-ant-clone-sharing-test-000000");
    }
}
