//! `ai/ollama.rs` — Section 9 Phase 12 sub-step B: the local Ollama
//! adapter. See `ai/anthropic.rs`'s doc comment for the shared adapter
//! pattern (`resolve_context`, the `#[cfg(test)]`-only endpoint seam) —
//! this file follows it exactly.
//!
//! ## Not exempt from redaction
//!
//! Ollama runs on `127.0.0.1` by default, but "local" is not an excuse to
//! skip Section 8.9: this adapter routes through the identical
//! `RedactedPayload` chokepoint as every other provider —
//! `resolve_context` calls the same `permit::acquire`, and `complete`/
//! `test` call the exact same `ai::http::send` as `ai/anthropic.rs`, with
//! `ProviderShape::Ollama` as the only difference. There is no separate
//! HTTP path, no separate endpoint argument, and no separate redaction (or
//! lack of it) for local traffic. `tests::ollamas_outbound_bytes_are_redacted_exactly_like_anthropics`
//! proves this directly against a real local listener, using the exact
//! same shared assertion helper `ai/anthropic.rs`'s test does.
//!
//! ## Why this adapter still requires a stored key
//!
//! Section 12's gate (`ai::permit::acquire`) is "`settings.ai.isEnabled
//! === true` **and** a key is retrievable" — worded as a blanket
//! requirement, not provider-conditional, and that gate is frozen,
//! already-reviewed code from step 2b that this step does not touch.
//! Local Ollama installs commonly run with no authentication at all, so
//! requiring *some* stored value here is arguably stricter than the real
//! world needs — but weakening `acquire` per-provider would mean two
//! different "AI is on" gates existing in the same crate, which is exactly
//! the kind of asymmetry a bypass hides in. This adapter does not use the
//! retrieved key for anything (no auth header is sent — see
//! `build_headers` below); it exists purely to satisfy the uniform gate.
//! Flagged for owner confirmation: whether local-Ollama-without-a-key
//! should get its own accommodation is a UX decision for whichever step
//! wires up the actual Settings UI (`commands/ai.rs`, not in scope here).

use std::path::PathBuf;

use crate::ai::endpoint::{self, ResolvedEndpoint};
use crate::ai::http::{self, ProviderShape, RequestHeaders};
use crate::ai::permit::{self, EgressPermit};
use crate::ai::provider::{AiProvider, CompletionRequest, CompletionResponse, TestResult};
use crate::commands::settings::load_stored_ai_settings;
use crate::error::AppError;
use crate::secrets::ai_key::AiKeyStore;

pub struct OllamaProvider {
    settings_path: PathBuf,
    ai_keys: AiKeyStore,
    #[cfg(test)]
    test_endpoint: Option<String>,
}

impl OllamaProvider {
    pub fn new(settings_path: PathBuf, ai_keys: AiKeyStore) -> Self {
        OllamaProvider {
            settings_path,
            ai_keys,
            #[cfg(test)]
            test_endpoint: None,
        }
    }

    /// `#[cfg(test)]`-only — see `ai/anthropic.rs`'s doc comment. Does not
    /// exist in any non-test build.
    #[cfg(test)]
    pub(crate) fn with_test_endpoint(mut self, url: impl Into<String>) -> Self {
        self.test_endpoint = Some(url.into());
        self
    }

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

        Ok(ResolvedContext {
            permit,
            endpoint,
            model,
        })
    }
}

struct ResolvedContext {
    permit: EgressPermit,
    endpoint: ResolvedEndpoint,
    model: String,
}

/// No auth header — see this module's doc comment on why a stored key is
/// still required by the uniform gate but is not sent anywhere.
fn build_headers() -> RequestHeaders {
    RequestHeaders::new()
}

/// Ollama's `/api/chat` response shape:
/// `{"message": {"role": "assistant", "content": "..."}, "done": true, ...}`.
fn parse_completion_response(raw_body: &str) -> Result<CompletionResponse, AppError> {
    let value: serde_json::Value = serde_json::from_str(raw_body).map_err(|err| {
        AppError::ai_network(
            false,
            format!("unparseable response body: {err}; body={raw_body}"),
        )
    })?;
    let text = value
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .ok_or_else(|| {
            AppError::ai_network(false, format!("unexpected response shape: {raw_body}"))
        })?;
    Ok(CompletionResponse {
        text: text.to_string(),
    })
}

impl AiProvider for OllamaProvider {
    /// `req.instructions` is not yet threaded into the outbound request —
    /// see `ai::http`'s doc comment. Identical shape to
    /// `AnthropicProvider::complete` except `ProviderShape::Ollama` and no
    /// auth header.
    async fn complete(&self, req: CompletionRequest) -> Result<CompletionResponse, AppError> {
        let ctx = self.resolve_context()?;
        let headers = build_headers();
        let response = http::send(
            &ctx.permit,
            &ctx.endpoint,
            &headers,
            ProviderShape::Ollama,
            &ctx.model,
            &req.payload,
        )?;
        parse_completion_response(&response.body)
    }

    async fn test(&self) -> Result<TestResult, AppError> {
        let ctx = self.resolve_context()?;
        let headers = build_headers();
        let empty_payload = crate::privacy::redact::redact(
            &crate::contract::EngineSnippetsResult { snippets: vec![] },
            &[],
        )?;
        let result = http::send(
            &ctx.permit,
            &ctx.endpoint,
            &headers,
            ProviderShape::Ollama,
            &ctx.model,
            &empty_payload,
        );
        Ok(TestResult {
            is_ok: result.is_ok(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::settings::{
        update_settings_core, AiProvider as ProviderKind, AiSettingsPatch, SettingsPatch,
    };
    use crate::contract::{EngineSnippet, EngineSnippetsResult};
    use crate::secrets::ai_key::AiKey;
    use std::future::Future;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::pin::Pin;
    use std::sync::mpsc;
    use std::task::{Context, Poll, RawWaker, RawWakerVTable, Waker};

    // Same hand-rolled single-poll executor as `ai::anthropic::tests` — see
    // that module's doc comment for why this crate doesn't add a
    // dependency to drive a future that never actually suspends.
    fn noop_raw_waker() -> RawWaker {
        fn clone(_: *const ()) -> RawWaker {
            noop_raw_waker()
        }
        fn no_op(_: *const ()) {}
        static VTABLE: RawWakerVTable = RawWakerVTable::new(clone, no_op, no_op, no_op);
        RawWaker::new(std::ptr::null(), &VTABLE)
    }

    fn noop_waker() -> Waker {
        // SAFETY: see `ai::anthropic::tests::noop_waker` — identical
        // invariant, identical vtable shape.
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

    /// Same minimal raw-HTTP capturing listener as
    /// `ai::anthropic::tests::spawn_capturing_server`, replying with an
    /// Ollama-shaped response instead of an Anthropic-shaped one so
    /// response parsing also succeeds end-to-end.
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
                    break;
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

            let response_body = br#"{"message":{"role":"assistant","content":"ok"},"done":true}"#;
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

    /// See `ai::anthropic::tests::KeychainCleanupGuard`'s doc comment for
    /// why this holds `REAL_KEYCHAIN_TEST_LOCK`.
    struct KeychainCleanupGuard {
        provider_key: &'static str,
        _lock: std::sync::MutexGuard<'static, ()>,
    }
    impl Drop for KeychainCleanupGuard {
        fn drop(&mut self) {
            let _ = AiKeyStore::new().clear(self.provider_key);
        }
    }

    fn enable_real_ollama(
        dir: &std::path::Path,
    ) -> (std::path::PathBuf, AiKeyStore, KeychainCleanupGuard) {
        let lock = crate::secrets::ai_key::REAL_KEYCHAIN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let settings_path = dir.join("settings.json");
        let ai_keys = AiKeyStore::new();
        // See this module's doc comment: the uniform gate still requires a
        // stored value even though it is never sent as an auth header.
        let key = AiKey::parse("ollama-adapter-test-placeholder-0").unwrap();
        ai_keys
            .store(ProviderKind::Ollama.key_str(), &key)
            .expect("store must succeed");
        assert!(
            crate::secrets::ai_key::eventually(|| ai_keys.has_key(ProviderKind::Ollama.key_str())),
            "sanity: the real key IS there before proceeding"
        );
        update_settings_core(
            &settings_path,
            &ai_keys,
            SettingsPatch {
                ai: Some(AiSettingsPatch {
                    is_enabled: Some(true),
                    provider: Some(ProviderKind::Ollama),
                    model: Some("llama-test-model".to_string()),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )
        .expect("update_settings_core must succeed");
        let cleanup = KeychainCleanupGuard {
            provider_key: ProviderKind::Ollama.key_str(),
            _lock: lock,
        };
        (settings_path, ai_keys, cleanup)
    }

    /// The owner's explicit Part B requirement: "A test should demonstrate
    /// ollama's outbound bytes are redacted exactly like Anthropic's" —
    /// same planted secret, same real local listener, same strengthened
    /// full-body allow-set check as `ai::anthropic::tests`'s equivalent.
    #[test]
    fn ollamas_outbound_bytes_are_redacted_exactly_like_anthropics() {
        let dir = tempfile::tempdir().unwrap();
        let (settings_path, ai_keys, _cleanup) = enable_real_ollama(dir.path());
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
        let expected_snippets = redacted_payload.to_request_snippets();
        assert!(expected_snippets[0].content.contains("<redacted>"));

        let provider = OllamaProvider::new(settings_path, ai_keys).with_test_endpoint(base_url);

        let result = block_on_never_pending(provider.complete(CompletionRequest {
            instructions: "Summarize this code.".to_string(),
            payload: redacted_payload,
        }));
        assert!(result.is_ok(), "complete() failed: {:?}", result.err());

        // Assert the listener actually received a request BEFORE trusting
        // anything about its body — vacuous-pass guard.
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

        let received_json: serde_json::Value =
            serde_json::from_slice(&received_body).expect("the received body must be valid JSON");
        crate::ai::http::test_support::assert_body_contains_nothing_beyond_scaffolding_and_snippets(
            &received_json,
            "llama-test-model",
            &expected_snippets,
        );
    }

    #[test]
    fn test_method_reports_success_against_a_real_listener() {
        let dir = tempfile::tempdir().unwrap();
        let (settings_path, ai_keys, _cleanup) = enable_real_ollama(dir.path());
        let (base_url, rx) = spawn_capturing_server();

        let provider = OllamaProvider::new(settings_path, ai_keys).with_test_endpoint(base_url);

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
        let provider = OllamaProvider::new(settings_path, ai_keys);

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
