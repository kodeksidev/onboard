//! The one place credential-shaped test strings are assembled.
//!
//! ## Why these are split rather than written literally
//!
//! GitHub push protection rejects this repository on the Stripe pattern in
//! `privacy::redact`'s corpus. Every string here is fake — most are
//! deliberately absurd (`abcdefghijklmnop`) — but scanners match **shape,
//! not secrecy**, so a fake in the right shape blocks a push exactly like a
//! real one. On a product whose thesis is that secrets stay local, clicking
//! through our own scanner's warning would be the wrong artefact to leave in
//! the history, so the literals are assembled from fragments instead. No
//! contiguous credential-shaped literal exists in any source file.
//!
//! Only the eight scanner-relevant families are here. The corpus's
//! connection-string, assignment-heuristic, entropy, auth-header, hex-blob
//! and PEM-body entries are not credential-shaped and no scanner matches
//! them, so splitting those would add indirection for nothing.
//!
//! ## Why this is `pub` and not `#[cfg(test)]`
//!
//! Three consumers are outside `#[cfg(test)]`: `bin/onboard_engine_stub.rs`
//! (a support binary, not a test), and the external compile-fail fixture
//! crates under `tests/fixtures/`, which can only reach this crate through
//! its public API. Making it test-only would force a second assembly site
//! for them, and a second site is precisely what this module exists to
//! prevent — the same defect as the hand-rolled newline reader that diverged
//! from `@onboard/contract`'s. `fake_secrets.guard.rs` fails if a
//! credential-shaped literal appears anywhere outside this file.
//!
//! ## The AWS example key specifically
//!
//! `aws_example_key_id()` is **not a secret and never was**: it is AWS's own published
//! documentation example, printed in their IAM docs. It is split here for
//! the same shape-matching reason as the rest, and this note exists so that
//! a reader of the rewritten history does not conclude the repository once
//! contained a live AWS key. It did not.

/// AWS access key id — AWS's published documentation example (see the module
/// doc comment: not a secret).
pub fn aws_example_key_id() -> String {
    format!("{}{}", "AKIA", "IOSFODNN7EXAMPLE")
}

/// A second AWS-shaped id, obviously synthetic.
pub fn aws_synthetic_key_id() -> String {
    format!("{}{}", "AKIA", "ABCDEFGHIJKLMNOP")
}

/// A third, for the in-comment corpus case.
pub fn aws_comment_key_id() -> String {
    format!("{}{}", "AKIA", "ZZZZZZZZZZZZZZZZ")
}

/// GitHub personal-access-token shape.
pub fn github_pat() -> String {
    format!("{}{}", "ghp_", "abcdefghijklmnopqrstuvwxyz0123456789AB")
}

/// GitHub server-token shape.
pub fn github_server_token() -> String {
    format!("{}{}", "ghs_", "abcdefghijklmnopqrstuvwxyz0123456789")
}

/// GitHub PAT, uppercase variant.
pub fn github_pat_upper() -> String {
    format!("{}{}", "ghp_", "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345678")
}

/// Slack bot token.
pub fn slack_bot_token() -> String {
    format!("{}{}", "xoxb-", "111111111111-222222222222-abcdefghij")
}

/// Slack user token.
pub fn slack_user_token() -> String {
    format!("{}{}", "xoxp-", "1234567890-abcdefghij")
}

/// Slack app token.
pub fn slack_app_token() -> String {
    format!("{}{}", "xoxa-", "abcdefghijklmnop")
}

/// Stripe live secret key — the shape that actually blocked the push.
pub fn stripe_secret_key() -> String {
    format!("{}{}{}", "sk", "_live_", "abcdefghijklmnop1234567890")
}

/// Stripe restricted key.
pub fn stripe_restricted_key() -> String {
    format!("{}{}{}", "rk", "_live_", "abcdefghijklmnop123456")
}

/// Stripe publishable key.
pub fn stripe_publishable_key() -> String {
    format!("{}{}{}", "pk", "_live_", "abcdefghijklmnop1234567890")
}

/// Google API key.
pub fn google_api_key() -> String {
    format!("{}{}", "AIza", "SyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456")
}

/// Google API key, repeated-character variant.
pub fn google_api_key_repeated() -> String {
    format!("{}{}", "AIza", "SyZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ")
}

/// OpenAI key shape. Note this is a REDACTION rule (Section 8.9 rule 7) for
/// keys found in the user's own repo — unrelated to which providers Onboard
/// talks to (A4: Anthropic and Ollama only).
pub fn openai_key() -> String {
    format!("{}{}", "sk-", "abcdefghijklmnopqrstuvwxyz123456")
}

/// OpenAI key, uppercase variant.
pub fn openai_key_upper() -> String {
    format!("{}{}", "sk-", "ABCDEFGHIJKLMNOPQRSTUVWX")
}

/// Anthropic key shape.
pub fn anthropic_key() -> String {
    format!("{}{}{}", "sk-", "ant-", "abcdefghijklmnopqrstuvwxyz1234")
}

/// Anthropic key, uppercase variant.
pub fn anthropic_key_upper() -> String {
    format!("{}{}{}", "sk-", "ant-", "ABCDEFGHIJKLMNOPQRSTUVWX")
}

/// A short Anthropic-shaped key used by adapter and keychain tests, where
/// the value only has to parse as a key.
pub fn anthropic_key_short() -> String {
    format!("{}{}{}", "sk-", "ant-", "abcdefghijklmnop")
}

/// An Anthropic-shaped key for `ai::permit`'s real-keychain tests, which
/// need two distinct values.
pub fn anthropic_key_permit(suffix: char) -> String {
    format!(
        "{}{}{}{}",
        "sk-",
        "ant-",
        "permittest",
        suffix.to_string().repeat(14)
    )
}

/// JWT header+payload prefix (the corpus's rule-9 entry).
pub fn jwt_hs256() -> String {
    format!(
        "{}{}.{}.{}",
        "eyJ",
        "hbGciOiJIUzI1NiJ9",
        "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
        "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PYE"
    )
}

/// JWT with a typ header, used in the bearer-token corpus entry.
pub fn jwt_hs256_with_typ() -> String {
    format!(
        "{}{}.{}.{}",
        "eyJ", "hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", "eyJzdWIiOiIxMjM0In0", "abcdefghij1234567890"
    )
}
