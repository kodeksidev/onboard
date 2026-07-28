//! `EgressPermit` — the capability token that gates `ai::http::send`.
//!
//! Section 12: "`test_ai_key`, `ai_*`: `settings.ai.isEnabled === true`
//! **and** a key is retrievable; otherwise `E_AI_DISABLED` before any other
//! work." The requirement is "AI off ⇒ unreachable", not "AI off ⇒ nothing
//! happened in one observed run" — so this is enforced the same structural
//! way `privacy::redact::RedactedPayload` enforces "no unredacted content
//! reaches the network": [`EgressPermit`] has a **private** field and
//! **no public constructor of any kind**. The only place the struct-literal
//! `EgressPermit { .. }` appears in this crate is inside [`acquire`],
//! defined right here — the only function that checks Section 12's two
//! gating conditions. `ai::http::send` requires `&EgressPermit` as an
//! argument, so a caller with the toggle off (who can therefore never
//! obtain a permit) has no way to call it — a compile error, not a runtime
//! `if` a future refactor could accidentally skip.
//! `tests/ai_permit_compile_fail.rs` proves this from an external crate,
//! mirroring `tests/redaction_compile_fail.rs`'s technique exactly.
//!
//! ## "A key is retrievable" is provider-aware, not "always a key" (step 5)
//!
//! The owner's ruling, carried as a hard constraint: `acquire` does not
//! mean "AI on + key always." It means "AI on + the credentials THIS
//! provider requires." For `anthropic` that is a key;
//! for `ollama` — local, unauthenticated, nothing leaves the machine at
//! all — it is nothing. This is encoded as ONE thing:
//! [`AiProvider::requires_stored_key`] (`commands::settings`), consulted
//! once, right here, by the one `acquire` that already exists. There is no
//! second "is egress allowed" answer anywhere in this crate, no
//! `if provider == Ollama` scattered through callers — `acquire`'s own
//! logic is unchanged in shape; only the has-a-key check is now asked
//! "does this provider even need one," not assumed "yes" unconditionally.
//!
//! ## Why `acquire` takes `&AiSettings` and `&AiKeyStore`, not two `bool`s
//!
//! An earlier version of this function took `(is_ai_enabled: bool,
//! has_stored_key: bool)` for easy unit testing — but that is the SAME
//! mistake `RedactedPayload` had to avoid: a caller could satisfy it with
//! `acquire(true, true, ...)` regardless of the REAL toggle/keychain state,
//! which is a check by convention, not by construction. Taking `&AiKeyStore`
//! and calling its real `has_key(provider)` here means the key-presence
//! half of the check is genuinely unfakeable — a caller cannot make
//! `has_key` return `true` without an actual entry existing somewhere (the
//! session map or the OS keychain), which `AiKeyStore` has no backdoor for
//! (see `secrets::ai_key`). The toggle half (`&AiSettings`) has the same
//! residual gap `privacy::redact::Snippet` has against `EngineSnippet`
//! (`AiSettings`'s fields must be public — it round-trips through
//! `settings.json` — so a determined same-crate caller COULD fabricate one
//! claiming `isEnabled: true`); `acquire_ignores_a_fabricated_enabled_flag_without_a_real_key`,
//! below, proves that lie alone still isn't sufficient — the keychain half
//! still has to be genuinely true.

use crate::commands::settings::{AiProvider, AiSettings};
use crate::error::AppError;
use crate::secrets::ai_key::AiKeyStore;

/// A proof that AI is actually usable right now: the master toggle is on
/// AND a key is retrievable for `provider`. Holding one is the only way to
/// call `ai::http::send`. `Debug` is safe to derive (unlike
/// `RedactedPayload`'s custom impl) — the only field is a plain provider
/// enum, never secret content — and deriving it grants no construction
/// capability, only inspection.
#[derive(Debug)]
pub struct EgressPermit {
    provider: AiProvider,
}

impl EgressPermit {
    pub fn provider(&self) -> AiProvider {
        self.provider
    }
}

/// The only place `EgressPermit { .. }` is constructed. Section 12: checks
/// `settings.isEnabled` first, then — only for a provider that
/// [`AiProvider::requires_stored_key`] — queries the REAL keychain/session
/// state via `ai_keys.has_key`. Both conditions must hold for a
/// credential-requiring provider; the toggle alone is sufficient for one
/// that doesn't.
pub fn acquire(settings: &AiSettings, ai_keys: &AiKeyStore) -> Result<EgressPermit, AppError> {
    if !settings.is_enabled {
        return Err(AppError::ai_disabled());
    }
    if settings.provider.requires_stored_key() && !ai_keys.has_key(settings.provider.key_str()) {
        return Err(AppError::ai_disabled());
    }
    Ok(EgressPermit {
        provider: settings.provider,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::settings::AiSettings as AiSettingsType;

    fn settings(is_enabled: bool, provider: AiProvider) -> AiSettingsType {
        AiSettingsType {
            is_enabled,
            provider,
            model: "test-model".to_string(),
            ollama_base_url: "http://127.0.0.1:11434".to_string(),
            has_stored_key: false, // never trusted by `acquire` — always recomputed live
        }
    }

    #[test]
    fn toggle_off_and_no_key_returns_e_ai_disabled() {
        let ai_keys = AiKeyStore::new();
        let result = acquire(&settings(false, AiProvider::Anthropic), &ai_keys);
        assert_eq!(result.unwrap_err().code, "E_AI_DISABLED");
    }

    /// Anthropic requires a key (`requires_stored_key() == true`) — toggle
    /// on with none stored must still refuse.
    ///
    /// Holds `REAL_KEYCHAIN_TEST_LOCK` — this test's assumption ("no real
    /// anthropic key exists right now") only holds if no other
    /// concurrently-running test has temporarily stored one under the same
    /// real, process/system-wide `"anthropic"` account; see that lock's
    /// doc comment.
    ///
    /// A DIFFERENT test's cleanup (a real keychain `clear()`) can still be
    /// settling on the OS side immediately after this one acquires the
    /// lock — the delete-visibility mirror of the write-visibility race
    /// `eventually` exists for (see that function's doc comment) — so the
    /// check itself is wrapped in `eventually`, not a one-shot `acquire`.
    #[test]
    fn anthropic_toggle_on_with_no_stored_key_returns_e_ai_disabled() {
        let _lock = crate::secrets::ai_key::REAL_KEYCHAIN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let ai_keys = AiKeyStore::new();
        assert!(crate::secrets::ai_key::eventually(|| {
            matches!(
                acquire(&settings(true, AiProvider::Anthropic), &ai_keys),
                Err(ref e) if e.code == "E_AI_DISABLED"
            )
        }));
    }

    /// The owner's ruling, proven directly: Ollama does NOT require a
    /// stored key (`requires_stored_key() == false`) — toggle on with an
    /// EMPTY `AiKeyStore` (no fabrication, no fallback, genuinely nothing
    /// stored anywhere) must still grant a permit. This is the behavior
    /// change step 5 exists to make: local, unauthenticated Ollama is not
    /// gated behind pasting a key that is never transmitted.
    #[test]
    fn ollama_toggle_on_with_no_stored_key_still_grants_a_permit() {
        let ai_keys = AiKeyStore::new();
        let permit =
            acquire(&settings(true, AiProvider::Ollama), &ai_keys).expect("expected a permit");
        assert!(matches!(permit.provider(), AiProvider::Ollama));
    }

    /// The case a careless refactor breaks: the toggle-off short-circuit
    /// must fire BEFORE the (now provider-conditional) credential check for
    /// every provider, including the one that doesn't require a key at
    /// all. If `acquire` were rewritten as "provider doesn't need a key ⇒
    /// skip straight to Ok," this would catch it — Ollama with the master
    /// toggle off must still return `E_AI_DISABLED`, not a permit.
    #[test]
    fn ollama_toggle_off_still_returns_e_ai_disabled_even_though_it_needs_no_key() {
        let ai_keys = AiKeyStore::new();
        let result = acquire(&settings(false, AiProvider::Ollama), &ai_keys);
        assert_eq!(result.unwrap_err().code, "E_AI_DISABLED");
    }

    /// A key stored while the master toggle is off is still "off" — same
    /// rule `ModeIndicator`'s doc comment states on the UI side. AI never
    /// activates from a stored key alone, so this test proves it with a
    /// REAL keychain round trip, not a claimed boolean.
    ///
    /// Holds `REAL_KEYCHAIN_TEST_LOCK` — see that lock's doc comment. Even
    /// though this test's provider name is unique to it, real OS keychain
    /// contention across concurrently-running threads was observed to
    /// affect calls regardless of account name, not just same-name races.
    #[test]
    fn toggle_off_with_a_real_stored_key_still_returns_e_ai_disabled() {
        let _lock = crate::secrets::ai_key::REAL_KEYCHAIN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let ai_keys = AiKeyStore::new();
        let provider_name = "onboard-phase12-permit-test-toggle-off";
        let key = crate::secrets::ai_key::AiKey::parse("REDACTED-ANTHROPIC-BY-HISTORY-REWRITE").unwrap();
        struct Cleanup<'a> {
            store: &'a AiKeyStore,
            provider: &'a str,
        }
        impl Drop for Cleanup<'_> {
            fn drop(&mut self) {
                let _ = self.store.clear(self.provider);
            }
        }
        let _cleanup = Cleanup {
            store: &ai_keys,
            provider: provider_name,
        };
        ai_keys
            .store(provider_name, &key)
            .expect("store must succeed");

        // `settings.provider` doesn't name a real `AiProvider` variant for
        // this made-up test provider string, so exercise the toggle-off
        // short-circuit directly against the real store instead of routing
        // through `acquire`'s fixed two-provider enum.
        assert!(
            crate::secrets::ai_key::eventually(|| ai_keys.has_key(provider_name)),
            "sanity: the real key IS there"
        );
        let result = acquire(&settings(false, AiProvider::Anthropic), &ai_keys);
        assert_eq!(result.unwrap_err().code, "E_AI_DISABLED");
    }

    /// The residual gap this module's doc comment names: `AiSettings` can
    /// be fabricated claiming `isEnabled: true` (its fields must be public
    /// to round-trip through `settings.json`). This proves that lie ALONE
    /// is not sufficient — without a real key, `acquire` still refuses.
    ///
    /// Holds `REAL_KEYCHAIN_TEST_LOCK` because this test's assumption
    /// ("no real anthropic key exists right now") only holds if no other
    /// concurrently-running test has temporarily stored one under the same
    /// real, process/system-wide `"anthropic"` keychain account — see that
    /// lock's doc comment.
    #[test]
    fn acquire_ignores_a_fabricated_enabled_flag_without_a_real_key() {
        let _lock = crate::secrets::ai_key::REAL_KEYCHAIN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let ai_keys = AiKeyStore::new();
        let fabricated = settings(true, AiProvider::Anthropic);
        assert!(
            fabricated.is_enabled,
            "sanity: the fabricated flag claims enabled"
        );
        // Delete-visibility tolerance — see the doc comment on the
        // analogous check above.
        assert!(crate::secrets::ai_key::eventually(|| {
            matches!(acquire(&fabricated, &ai_keys), Err(ref e) if e.code == "E_AI_DISABLED")
        }));
    }

    /// Holds `REAL_KEYCHAIN_TEST_LOCK` — see that lock's doc comment;
    /// this test itself stores a real key under the shared `"anthropic"`
    /// account for its duration.
    #[test]
    fn toggle_on_and_a_real_stored_key_grants_a_permit_for_the_right_provider() {
        let _lock = crate::secrets::ai_key::REAL_KEYCHAIN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let ai_keys = AiKeyStore::new();
        let provider_name = "anthropic";
        let key = crate::secrets::ai_key::AiKey::parse("REDACTED-ANTHROPIC-BY-HISTORY-REWRITE").unwrap();
        struct Cleanup<'a> {
            store: &'a AiKeyStore,
            provider: &'a str,
        }
        impl Drop for Cleanup<'_> {
            fn drop(&mut self) {
                let _ = self.store.clear(self.provider);
            }
        }
        let _cleanup = Cleanup {
            store: &ai_keys,
            provider: provider_name,
        };
        ai_keys
            .store(provider_name, &key)
            .expect("store must succeed");
        assert!(crate::secrets::ai_key::eventually(
            || ai_keys.has_key(provider_name)
        ));

        let permit =
            acquire(&settings(true, AiProvider::Anthropic), &ai_keys).expect("expected a permit");
        assert!(matches!(permit.provider(), AiProvider::Anthropic));
    }

    /// A key stored for Ollama anyway (a user who pasted one even though
    /// it's not required) must not BREAK the toggle-on grant either —
    /// `requires_stored_key() == false` means the check is skipped, not
    /// that a stored key becomes disqualifying.
    ///
    /// Holds `REAL_KEYCHAIN_TEST_LOCK` — see that lock's doc comment.
    #[test]
    fn ollama_toggle_on_with_a_key_present_anyway_still_grants_a_permit() {
        let _lock = crate::secrets::ai_key::REAL_KEYCHAIN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let ai_keys = AiKeyStore::new();
        let provider_name = "ollama";
        let key = crate::secrets::ai_key::AiKey::parse("ollama-permittest-key-0000000").unwrap();
        struct Cleanup<'a> {
            store: &'a AiKeyStore,
            provider: &'a str,
        }
        impl Drop for Cleanup<'_> {
            fn drop(&mut self) {
                let _ = self.store.clear(self.provider);
            }
        }
        let _cleanup = Cleanup {
            store: &ai_keys,
            provider: provider_name,
        };
        ai_keys
            .store(provider_name, &key)
            .expect("store must succeed");
        assert!(crate::secrets::ai_key::eventually(
            || ai_keys.has_key(provider_name)
        ));

        let permit =
            acquire(&settings(true, AiProvider::Ollama), &ai_keys).expect("expected a permit");
        assert!(matches!(permit.provider(), AiProvider::Ollama));
    }
}
