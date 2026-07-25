//! OS keychain access (`keyring` 3.6) under service `dev.onboard.app`,
//! account `ai.<provider>.apiKey` (Section 6.2). This module never logs a
//! secret value and never writes one to a plaintext file — the only
//! persistence path is the OS-native secure store.

use keyring::Entry;

pub const KEYCHAIN_SERVICE: &str = "dev.onboard.app";

/// True when a `keyring::Error` means "there is no usable OS secret store
/// on this machine" (A18's Linux-without-a-daemon case) rather than some
/// other transient failure. Kept as its own function so the fallback
/// decision in `ai_key.rs` is unit-testable against synthetic errors
/// without needing a real headless Linux session.
pub fn is_backend_unavailable(err: &keyring::Error) -> bool {
    matches!(
        err,
        keyring::Error::NoStorageAccess(_) | keyring::Error::PlatformFailure(_)
    )
}

pub fn account_for(provider: &str) -> String {
    format!("ai.{provider}.apiKey")
}

pub struct Keychain;

impl Keychain {
    pub fn set(account: &str, secret: &str) -> Result<(), keyring::Error> {
        Entry::new(KEYCHAIN_SERVICE, account)?.set_password(secret)
    }

    pub fn get(account: &str) -> Result<Option<String>, keyring::Error> {
        match Entry::new(KEYCHAIN_SERVICE, account)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(other) => Err(other),
        }
    }

    pub fn delete(account: &str) -> Result<(), keyring::Error> {
        match Entry::new(KEYCHAIN_SERVICE, account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(other) => Err(other),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_name_matches_the_frozen_settings_convention() {
        assert_eq!(account_for("anthropic"), "ai.anthropic.apiKey");
        assert_eq!(account_for("ollama"), "ai.ollama.apiKey");
    }

    #[test]
    fn no_storage_access_is_treated_as_backend_unavailable() {
        let err = keyring::Error::NoStorageAccess(Box::new(std::io::Error::other("no dbus")));
        assert!(is_backend_unavailable(&err));
    }

    #[test]
    fn no_entry_is_not_treated_as_backend_unavailable() {
        assert!(!is_backend_unavailable(&keyring::Error::NoEntry));
    }
}
