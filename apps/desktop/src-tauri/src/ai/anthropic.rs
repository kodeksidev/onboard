//! `ai/anthropic.rs` — Section 9 Phase 12 sub-step A: the Anthropic
//! Messages API adapter, the first real implementation of
//! [`crate::ai::provider::AiProvider`]. See that module's doc comment for
//! the trait shape and the `AiProvider`-naming-collision note.
//!
//! Every real request routes through all three legs of `ai::http::send`'s
//! triad (`ai::http`'s own doc comment): [`crate::ai::permit::acquire`]
//! (WHETHER), [`crate::ai::endpoint::resolve`] (WHERE), and the caller's
//! `RedactedPayload` (WHAT) — [`AnthropicProvider::resolve_context`] is the
//! only place any of those three are obtained, and it is called at the top
//! of both `complete` and `test`. Provider, model, and key all come from
//! `StoredAiSettings`/`AiKeyStore` inside `resolve_context`, never a
//! caller argument to either trait method.
//!
//! ## The endpoint seam this adapter uses for its own tests
//!
//! [`AnthropicProvider::with_test_endpoint`] and the `test_endpoint` field
//! are both `#[cfg(test)]` — compiled out of every non-test build
//! entirely, not merely unused. In a release binary, `resolve_context`
//! reduces to exactly one line, `crate::ai::endpoint::resolve(&stored)?`;
//! there is no field, no branch, no code path left for a caller to reach.
//! See `docs/DECISIONS.md`'s Phase 12 step 3A entry and
//! `ai/endpoint.rs::resolve_for_test`'s doc comment for the full
//! justification.

use std::path::PathBuf;

use crate::ai::endpoint::{self, ResolvedEndpoint};
use crate::ai::http::{self, RequestHeaders};
use crate::ai::permit::{self, EgressPermit};
use crate::ai::provider::{AiProvider, CompletionRequest, CompletionResponse, TestResult};
use crate::commands::settings::{load_stored_ai_settings, AiProvider as ProviderKind};
use crate::error::AppError;
use crate::privacy::redact::RedactedPayload;
use crate::secrets::ai_key::{AiKey, AiKeyStore};

const ANTHROPIC_VERSION: &str = "2023-06-01";
const ANTHROPIC_MAX_TOKENS: u32 = 1024;

pub struct AnthropicProvider {
    settings_path: PathBuf,
    ai_keys: AiKeyStore,
    #[cfg(test)]
    test_endpoint: Option<String>,
}

impl AnthropicProvider {
    pub fn new(settings_path: PathBuf, ai_keys: AiKeyStore) -> Self {
        AnthropicProvider {
            settings_path,
            ai_keys,
            #[cfg(test)]
            test_endpoint: None,
        }
    }

    /// `#[cfg(test)]`-only — see this module's doc comment. Does not exist
    /// in any non-test build.
    #[cfg(test)]
    pub(crate) fn with_test_endpoint(mut self, url: impl Into<String>) -> Self {
        self.test_endpoint = Some(url.into());
        self
    }

    /// The only place `permit`/`endpoint`/`key`/`model` are resolved for a
    /// real request — called once at the top of both trait methods.
    fn resolve_context(&self) -> Result<ResolvedContext, AppError> {
        let stored = load_stored_ai_settings(&self.settings_path, &self.ai_keys);
        let permit = permit::acquire(stored.ai(), &self.ai_keys)?;
        let model = stored.ai().model.clone();

        #[cfg(test)]
        let endpoint = match &self.test_endpoint {
            Some(url) => endpoint::resolve_for_test(url.clone()),
            None => endpoint::resolve(&stored)?,
        };
        #[cfg(not(test))]
        let endpoint = endpoint::resolve(&stored)?;

        let key = self.ai_keys.retrieve(ProviderKind::Anthropic.key_str())?;
        Ok(ResolvedContext {
            permit,
            endpoint,
            key,
            model,
        })
    }
}

struct ResolvedContext {
    permit: EgressPermit,
    endpoint: ResolvedEndpoint,
    key: AiKey,
    model: String,
}

/// Plain `RequestHeaders` — never the HTTP client's own header type — so
/// this adapter never needs to import the HTTP client crate at all. See
/// `ai::http`'s doc comment.
fn build_headers(key: &AiKey) -> RequestHeaders {
    let mut headers = RequestHeaders::new();
    headers.insert("x-api-key", key.reveal());
    headers.insert("anthropic-version", ANTHROPIC_VERSION);
    headers
}

/// Joins `instructions` with every redacted snippet's path/line-range/
/// content into one Anthropic "user" message. `payload.to_request_snippets()`
/// is the ONLY source of snippet content here — see `redact.rs`'s doc
/// comment for what that accessor does and does not guarantee.
fn build_message_content(instructions: &str, payload: &RedactedPayload) -> String {
    let mut content = instructions.to_string();
    for snippet in payload.to_request_snippets() {
        content.push_str(&format!(
            "\n\n--- {} (lines {}-{}) ---\n{}",
            snippet.path, snippet.start_line, snippet.end_line, snippet.content
        ));
    }
    content
}

fn build_completion_body(
    model: &str,
    instructions: &str,
    payload: &RedactedPayload,
) -> serde_json::Value {
    serde_json::json!({
        "model": model,
        "max_tokens": ANTHROPIC_MAX_TOKENS,
        "messages": [{ "role": "user", "content": build_message_content(instructions, payload) }],
    })
}

/// `test()`'s ping body: a trivial, single-token request against a real,
/// legitimately-empty `RedactedPayload` (built via the real `redact()`
/// with zero snippets — never a shortcut past it) just to confirm the
/// model/key/endpoint combination actually answers.
fn build_test_body(model: &str) -> serde_json::Value {
    serde_json::json!({
        "model": model,
        "max_tokens": 1,
        "messages": [{ "role": "user", "content": "ping" }],
    })
}

fn parse_completion_response(raw_body: &str) -> Result<CompletionResponse, AppError> {
    let value: serde_json::Value = serde_json::from_str(raw_body).map_err(|err| {
        AppError::ai_network(
            false,
            format!("unparseable response body: {err}; body={raw_body}"),
        )
    })?;
    let text = value
        .get("content")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|first| first.get("text"))
        .and_then(|t| t.as_str())
        .ok_or_else(|| {
            AppError::ai_network(false, format!("unexpected response shape: {raw_body}"))
        })?;
    Ok(CompletionResponse {
        text: text.to_string(),
    })
}

impl AiProvider for AnthropicProvider {
    async fn complete(&self, req: CompletionRequest) -> Result<CompletionResponse, AppError> {
        let ctx = self.resolve_context()?;
        let headers = build_headers(&ctx.key);
        let body = build_completion_body(&ctx.model, &req.instructions, &req.payload);
        let response = http::send(&ctx.permit, &ctx.endpoint, &headers, &body, &req.payload)?;
        parse_completion_response(&response.body)
    }

    async fn test(&self) -> Result<TestResult, AppError> {
        let ctx = self.resolve_context()?;
        let headers = build_headers(&ctx.key);
        let body = build_test_body(&ctx.model);
        let empty_payload = crate::privacy::redact::redact(
            &crate::contract::EngineSnippetsResult { snippets: vec![] },
            &[],
        )?;
        let result = http::send(&ctx.permit, &ctx.endpoint, &headers, &body, &empty_payload);
        Ok(TestResult {
            is_ok: result.is_ok(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::settings::{update_settings_core, AiSettingsPatch, SettingsPatch};
    use crate::contract::{EngineSnippet, EngineSnippetsResult};
    use std::future::Future;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::pin::Pin;
    use std::sync::mpsc;
    use std::task::{Context, Poll, RawWaker, RawWakerVTable, Waker};

    // -----------------------------------------------------------------
    // A minimal single-poll executor — see this module's doc comment
    // block above for why this crate hand-rolls one instead of adding a
    // dependency: `ai::provider::AiProvider`'s async methods wrap a
    // blocking HTTP call (see `ai::http`'s doc comment), so the future
    // they return never actually suspends and always resolves on the
    // first `poll`.
    // -----------------------------------------------------------------

    fn noop_raw_waker() -> RawWaker {
        fn clone(_: *const ()) -> RawWaker {
            noop_raw_waker()
        }
        fn no_op(_: *const ()) {}
        static VTABLE: RawWakerVTable = RawWakerVTable::new(clone, no_op, no_op, no_op);
        RawWaker::new(std::ptr::null(), &VTABLE)
    }

    fn noop_waker() -> Waker {
        // SAFETY: `noop_raw_waker`'s vtable functions (`clone`/`wake`/
        // `wake_by_ref`/`drop`) never read or write through the data
        // pointer — they ignore it entirely and either do nothing or
        // return a fresh identical `RawWaker`. A null data pointer that is
        // never dereferenced satisfies `Waker::from_raw`'s safety
        // contract.
        unsafe { Waker::from_raw(noop_raw_waker()) }
    }

    fn block_on_never_pending<F: Future>(future: F) -> F::Output {
        let waker = noop_waker();
        let mut cx = Context::from_waker(&waker);
        let mut future = Box::pin(future);
        loop {
            if let Poll::Ready(value) = Pin::new(&mut future).poll(&mut cx) {
                return value;
            }
        }
    }

    // -----------------------------------------------------------------
    // A real local HTTP listener the adapter genuinely POSTs to.
    // -----------------------------------------------------------------

    /// Accepts exactly one connection, reads the real HTTP request body
    /// (via `Content-Length`), sends it back over `rx` so the test can
    /// assert on it, then replies with a minimal valid Anthropic-shaped
    /// 200 response so `complete()`/`test()` succeed end-to-end.
    fn spawn_capturing_server() -> (String, mpsc::Receiver<Vec<u8>>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind a local test listener");
        let addr = listener
            .local_addr()
            .expect("resolve the bound local address");
        let (tx, rx) = mpsc::channel();

        std::thread::spawn(move || {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            let mut reader = BufReader::new(stream.try_clone().expect("clone the test socket"));
            let mut content_length = 0usize;
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 {
                    break;
                }
                let trimmed = line.trim_end();
                if trimmed.is_empty() {
                    break; // end of headers
                }
                let lower = trimmed.to_ascii_lowercase();
                if lower.starts_with("content-length:") {
                    content_length = trimmed["content-length:".len()..]
                        .trim()
                        .parse()
                        .unwrap_or(0);
                }
            }
            let mut body = vec![0u8; content_length];
            let _ = reader.read_exact(&mut body);
            let _ = tx.send(body);

            let response_body = br#"{"content":[{"type":"text","text":"ok"}]}"#;
            let response_head = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                response_body.len()
            );
            let _ = stream.write_all(response_head.as_bytes());
            let _ = stream.write_all(response_body);
            let _ = stream.flush();
        });

        (format!("http://{addr}"), rx)
    }

    /// Holds `secrets::ai_key::REAL_KEYCHAIN_TEST_LOCK` for the whole
    /// test's duration (not just the `store` call) — every test using
    /// [`enable_real_anthropic`] stores a real key under the shared,
    /// process/system-wide `"anthropic"` keychain account, which races
    /// against `ai::permit`'s tests of the same account unless serialized;
    /// see that lock's doc comment. Also cleans up the stored key on drop,
    /// via a fresh `AiKeyStore` — `clear()`'s job is deleting whatever is
    /// really there (session map or OS keychain), a system-wide/
    /// process-wide resource either way, so cleanup doesn't need to share
    /// an instance with the code under test the way RETRIEVAL does (see
    /// `enable_real_anthropic`'s comment on why *that* returns the same
    /// `AiKeyStore` instance it stored into).
    struct KeychainCleanupGuard {
        provider_key: &'static str,
        _lock: std::sync::MutexGuard<'static, ()>,
    }
    impl Drop for KeychainCleanupGuard {
        fn drop(&mut self) {
            let _ = AiKeyStore::new().clear(self.provider_key);
        }
    }

    /// Stores a real key and flips the real toggle on, through the real
    /// settings-file + keychain machinery (never a fabricated
    /// `AiSettings`). Returns the SAME `AiKeyStore` instance the key was
    /// stored into — if the OS keychain backend is unavailable in a given
    /// test environment, `AiKeyStore::store` falls back to a per-instance,
    /// in-memory session map (A18), so a *different* `AiKeyStore::new()`
    /// instance built later would not see it. Moving this exact instance
    /// into `AnthropicProvider::new` keeps the test correct regardless of
    /// which backend actually served the store.
    fn enable_real_anthropic(
        dir: &std::path::Path,
    ) -> (std::path::PathBuf, AiKeyStore, KeychainCleanupGuard) {
        let lock = crate::secrets::ai_key::REAL_KEYCHAIN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let settings_path = dir.join("settings.json");
        let ai_keys = AiKeyStore::new();
        let key = AiKey::parse("sk-ant-anthropic-adapter-test-0000").unwrap();
        ai_keys
            .store(ProviderKind::Anthropic.key_str(), &key)
            .expect("store must succeed");
        assert!(
            crate::secrets::ai_key::eventually(
                || ai_keys.has_key(ProviderKind::Anthropic.key_str())
            ),
            "sanity: the real key IS there before proceeding"
        );
        update_settings_core(
            &settings_path,
            &ai_keys,
            SettingsPatch {
                ai: Some(AiSettingsPatch {
                    is_enabled: Some(true),
                    provider: Some(ProviderKind::Anthropic),
                    model: Some("claude-test-model".to_string()),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )
        .expect("update_settings_core must succeed");
        let cleanup = KeychainCleanupGuard {
            provider_key: ProviderKind::Anthropic.key_str(),
            _lock: lock,
        };
        (settings_path, ai_keys, cleanup)
    }

    /// The hard requirement: a planted secret must appear as `<redacted>`
    /// in the bytes the adapter ACTUALLY sends over the wire — asserted
    /// against a real local listener's received body, not `redact()`'s
    /// return value and not a mock.
    #[test]
    fn a_planted_secret_is_redacted_in_the_bytes_actually_sent_over_the_wire() {
        let dir = tempfile::tempdir().unwrap();
        let (settings_path, ai_keys, _cleanup) = enable_real_anthropic(dir.path());
        let (base_url, rx) = spawn_capturing_server();

        let planted_secret = "REDACTED-AWS-BY-HISTORY-REWRITE"; // Section 8.9 rule 2 (AWS key)
        let redacted_payload = crate::privacy::redact::redact(
            &EngineSnippetsResult {
                snippets: vec![EngineSnippet {
                    path: "config/aws.ts".to_string(),
                    start_line: 1,
                    end_line: 1,
                    content: format!("aws_access_key_id = {planted_secret}"),
                }],
            },
            &[],
        )
        .expect("redact() must not abort on a single known-good rule match");
        // Sanity: the corpus test elsewhere already proves this, but this
        // specific input, in THIS test, must actually contain the
        // placeholder before we trust anything downstream of it.
        assert!(redacted_payload.to_request_snippets()[0]
            .content
            .contains("<redacted>"));

        let provider = AnthropicProvider::new(settings_path, ai_keys).with_test_endpoint(base_url);

        let result = block_on_never_pending(provider.complete(CompletionRequest {
            instructions: "Summarize this code.".to_string(),
            payload: redacted_payload,
        }));
        assert!(result.is_ok(), "complete() failed: {:?}", result.err());

        // Assert the listener actually received a request BEFORE trusting
        // anything about its body — a test that only checks "no secret in
        // the body" passes vacuously if no request ever arrived.
        let received_body = rx
            .recv_timeout(std::time::Duration::from_secs(15))
            .expect("the local listener never received a request — vacuous pass guard");
        let received_text = String::from_utf8_lossy(&received_body);

        assert!(
            received_text.contains("<redacted>"),
            "expected <redacted> in the bytes actually sent, got: {received_text}"
        );
        assert!(
            !received_text.contains(planted_secret),
            "the planted secret leaked into the bytes actually sent: {received_text}"
        );
    }

    #[test]
    fn test_method_reports_success_against_a_real_listener() {
        let dir = tempfile::tempdir().unwrap();
        let (settings_path, ai_keys, _cleanup) = enable_real_anthropic(dir.path());
        let (base_url, rx) = spawn_capturing_server();

        let provider = AnthropicProvider::new(settings_path, ai_keys).with_test_endpoint(base_url);

        let result = block_on_never_pending(provider.test());
        let received = rx
            .recv_timeout(std::time::Duration::from_secs(15))
            .expect("the local listener never received a request");
        assert!(!received.is_empty());
        assert!(result.unwrap().is_ok);
    }

    #[test]
    fn complete_fails_with_e_ai_disabled_when_the_toggle_is_off() {
        let dir = tempfile::tempdir().unwrap();
        let settings_path = dir.path().join("settings.json");
        let ai_keys = AiKeyStore::new();
        let provider = AnthropicProvider::new(settings_path, ai_keys);

        let empty_payload =
            crate::privacy::redact::redact(&EngineSnippetsResult { snippets: vec![] }, &[])
                .unwrap();
        let result = block_on_never_pending(provider.complete(CompletionRequest {
            instructions: "Summarize this code.".to_string(),
            payload: empty_payload,
        }));
        assert_eq!(result.unwrap_err().code, "E_AI_DISABLED");
    }
}
