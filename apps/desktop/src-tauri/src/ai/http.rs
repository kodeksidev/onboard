//! `ai/http.rs` — Section 5: "THE ONLY `reqwest` CLIENT IN THE REPOSITORY."
//!
//! [`send`] is the single function in this entire crate allowed to reach
//! the network. Its two structural guarantees:
//!
//! 1. **Cannot be called without proof AI is on.** The first parameter is
//!    `&EgressPermit` ([`crate::ai::permit`]), which has no public
//!    constructor — see that module's doc comment. `tests/ai_permit_compile_fail.rs`
//!    proves a caller without one cannot call this function at all.
//! 2. **Cannot be called with unredacted content.** The payload parameter
//!    is [`crate::privacy::redact::RedactedPayload`], not `&str`/`String`/
//!    `impl Into<String>` — see `redact.rs`'s doc comment for what that
//!    does and does not guarantee. There is no second `send`-like function,
//!    no `#[cfg(test)]`-only bypass, no "internal" raw-text path anywhere
//!    in this module.
//!
//! Section 12 error hygiene: a response body, a provider error string, or
//! an OS/transport error string is NEVER placed in `AppError.message` —
//! only in `.detail` (same convention Phase 11 fixed `error.rs` to follow
//! everywhere else). The mapping functions below take already-extracted
//! plain data (status code, body text, a boolean) rather than
//! `reqwest::Error` itself specifically so they are unit-testable without
//! a live network call — `reqwest::Error` has no public constructor either,
//! so no test in this crate can synthesize one.

use std::time::Duration;

use once_cell::sync::Lazy;
use reqwest::blocking::Client;
use reqwest::StatusCode;

use crate::ai::permit::EgressPermit;
use crate::error::AppError;
use crate::privacy::redact::RedactedPayload;

/// Section 12: "per-request timeout 60s, no automatic retry on 429/5xx."
pub const AI_REQUEST_TIMEOUT_SECS: u64 = 60;

/// The one `reqwest::Client` in the repository. `reqwest`'s blocking client
/// runs its own internal async runtime privately — nothing outside this
/// module needs to become async because of it (this crate has no `tokio`
/// direct dependency anywhere else, by design — Phase 6's sidecar RPC is
/// plain `std::process`/`std::thread`).
static HTTP_CLIENT: Lazy<Client> = Lazy::new(|| {
    Client::builder()
        .timeout(Duration::from_secs(AI_REQUEST_TIMEOUT_SECS))
        .build()
        .expect("reqwest client (rustls-tls, no default features) must build")
});

/// A successful response: the raw response body text, handed back for the
/// (not-yet-written, Phase 12 step 3) caller to parse per-provider. This
/// module does no provider-specific parsing — that is a later step.
pub struct AiResponse {
    pub body: String,
}

/// The only function in this crate that sends bytes over the network.
///
/// `_permit` proves AI is on (Section 12); `endpoint` is the fully-formed
/// target URL a caller supplies (no provider host allowlist lives here yet
/// — until Phase 12 step 3 adds real provider adapters, NOTHING in this
/// crate's production code calls `send` at all, so `endpoint` is inert;
/// the two allowed hosts, `api.anthropic.com` and the configured Ollama
/// `base_url`, become the ONLY values step 3's adapters ever pass here).
/// `headers`/`json_body` are plain, already-built request data — neither
/// parameter can carry raw repo content on its own; `payload` is what
/// proves the body actually came from a real `RedactedPayload`.
pub fn send(
    _permit: &EgressPermit,
    endpoint: &str,
    headers: reqwest::header::HeaderMap,
    payload: &RedactedPayload,
) -> Result<AiResponse, AppError> {
    let body = serde_json::json!({ "snippets": payload.to_request_snippets() });

    let response = HTTP_CLIENT
        .post(endpoint)
        .headers(headers)
        .json(&body)
        .send()
        .map_err(map_transport_error)?;

    let status = response.status();
    let body_text = response.text().unwrap_or_default();

    if !status.is_success() {
        return Err(map_http_error("the AI provider", status, &body_text));
    }
    Ok(AiResponse { body: body_text })
}

/// `reqwest::Error` has no public constructor, so no test can synthesize
/// one — `send`'s own `.map_err(map_transport_error)` above is what's
/// actually exercised at runtime; this function's OWN logic (never putting
/// `raw_detail` in `.message`) is proven by `build_network_error`'s tests
/// below, which it delegates to immediately.
fn map_transport_error(err: reqwest::Error) -> AppError {
    build_network_error(err.is_timeout(), err.to_string())
}

fn build_network_error(is_timeout: bool, raw_detail: String) -> AppError {
    AppError::ai_network(is_timeout, raw_detail)
}

/// Section 10's literal per-status copy, dispatched by status code. `body`
/// (the provider's raw response text) NEVER reaches `.message` — only
/// `.detail`, via each `AppError::ai_*` constructor.
fn map_http_error(provider_label: &str, status: StatusCode, body: &str) -> AppError {
    match status {
        StatusCode::UNAUTHORIZED => AppError::ai_key_invalid(provider_label, body.to_string()),
        StatusCode::NOT_FOUND => {
            AppError::ai_model_not_found(provider_label, "(unknown)", body.to_string())
        }
        StatusCode::TOO_MANY_REQUESTS => {
            AppError::ai_rate_limited(provider_label, None, body.to_string())
        }
        _ => build_network_error(false, format!("HTTP {status}: {body}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_network_error_never_puts_raw_detail_in_message() {
        let raw = "connection refused: os error 10061, secret-looking-token-abc123";
        let err = build_network_error(false, raw.to_string());
        assert_eq!(err.code, "E_AI_NETWORK");
        assert!(
            !err.message.contains(raw),
            "raw transport text leaked into message: {}",
            err.message
        );
        assert_eq!(err.detail.as_deref(), Some(raw));
    }

    #[test]
    fn build_network_error_distinguishes_timeout_in_message_copy() {
        let timeout_err = build_network_error(true, "elapsed".to_string());
        assert!(timeout_err.message.contains("timed out"));
        let other_err = build_network_error(false, "elapsed".to_string());
        assert!(!other_err.message.contains("timed out"));
    }

    #[test]
    fn map_http_error_401_never_puts_the_response_body_in_message() {
        let body = "{\"error\":{\"message\":\"invalid_api_key: sk-verysecretvalue\"}}";
        let err = map_http_error("anthropic", StatusCode::UNAUTHORIZED, body);
        assert_eq!(err.code, "E_AI_KEY_INVALID");
        assert!(!err.message.contains("sk-verysecretvalue"));
        assert_eq!(err.detail.as_deref(), Some(body));
    }

    #[test]
    fn map_http_error_429_never_puts_the_response_body_in_message() {
        let body = "rate limit exceeded, retry-after=30, account=acct_secret123";
        let err = map_http_error("anthropic", StatusCode::TOO_MANY_REQUESTS, body);
        assert_eq!(err.code, "E_AI_RATE_LIMITED");
        assert!(!err.message.contains("acct_secret123"));
        assert_eq!(err.detail.as_deref(), Some(body));
    }

    #[test]
    fn map_http_error_404_never_puts_the_response_body_in_message() {
        let body = "model \"claude-9\" not found for key sk-ant-hidden";
        let err = map_http_error("anthropic", StatusCode::NOT_FOUND, body);
        assert_eq!(err.code, "E_AI_MODEL_NOT_FOUND");
        assert!(!err.message.contains("sk-ant-hidden"));
        assert_eq!(err.detail.as_deref(), Some(body));
    }

    #[test]
    fn map_http_error_other_status_never_puts_the_response_body_in_message() {
        let body = "internal error, session=eyJhbGciOiJIUzI1NiJ9.secret.sig";
        let err = map_http_error("anthropic", StatusCode::INTERNAL_SERVER_ERROR, body);
        assert_eq!(err.code, "E_AI_NETWORK");
        assert!(!err.message.contains("eyJhbGciOiJIUzI1NiJ9"));
        assert!(err.detail.unwrap().contains(body));
    }

    #[test]
    fn request_timeout_constant_matches_section_12() {
        assert_eq!(AI_REQUEST_TIMEOUT_SECS, 60);
    }
}
