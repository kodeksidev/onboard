//! `ai/openai_compatible.rs` — Section 9 Phase 12 sub-step B: the
//! OpenAI-compatible chat-completions adapter, covering
//! DeepSeek/OpenAI/Groq/OpenRouter/Together and similar providers that
//! share the same REST shape. See `ai/anthropic.rs`'s doc comment for the
//! shared adapter pattern (`resolve_context`, the `#[cfg(test)]`-only
//! endpoint seam) — this file follows it exactly.
//!
//! `base_url` comes from `StoredAiSettings.openai_compatible_base_url` via
//! [`crate::ai::endpoint::resolve`] — never a caller argument (Section 12
//! step 3A/B's WHERE guarantee, unchanged for this third provider).

use std::path::PathBuf;

use crate::ai::endpoint::{self, ResolvedEndpoint};
use crate::ai::http::{self, ProviderShape, RequestHeaders};
use crate::ai::permit::{self, EgressPermit};
use crate::ai::provider::{AiProvider, CompletionRequest, CompletionResponse, TestResult};
use crate::commands::settings::{load_stored_ai_settings, AiProvider as ProviderKind};
use crate::error::AppError;
use crate::secrets::ai_key::{AiKey, AiKeyStore};

pub struct OpenAiCompatibleProvider {
    settings_path: PathBuf,
    ai_keys: AiKeyStore,
    #[cfg(test)]
    test_endpoint: Option<String>,
}

impl OpenAiCompatibleProvider {
    pub fn new(settings_path: PathBuf, ai_keys: AiKeyStore) -> Self {
        OpenAiCompatibleProvider {
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

    /// See `AnthropicProvider::resolve_context`'s doc comment for the
    /// `model_override` contract — identical here.
    fn resolve_context(&self, model_override: Option<&str>) -> Result<ResolvedContext, AppError> {
        let stored = load_stored_ai_settings(&self.settings_path, &self.ai_keys);
        let permit = permit::acquire(stored.ai(), &self.ai_keys)?;
        let model = model_override
            .map(str::to_string)
            .unwrap_or_else(|| stored.ai().model.clone());

        #[cfg(test)]
        let endpoint = match &self.test_endpoint {
            Some(url) => endpoint::resolve_for_test(url.clone()),
            None => endpoint::resolve(&stored)?,
        };
        #[cfg(not(test))]
        let endpoint = endpoint::resolve(&stored)?;

        let key = self
            .ai_keys
            .retrieve(ProviderKind::OpenAiCompatible.key_str())?;
        Ok(ResolvedContext {
            permit,
            endpoint,
            key,
            model,
        })
    }

    /// Section 9 Phase 12 step 5's `test_ai_key` command — see
    /// `AnthropicProvider::test_with_model`'s doc comment.
    pub async fn test_with_model(&self, model: &str) -> Result<TestResult, AppError> {
        let ctx = self.resolve_context(Some(model))?;
        run_test(&ctx).await
    }
}

/// See `ai::anthropic::run_test`'s doc comment — identical error-propagation
/// contract, no reclassification (that's Ollama-only).
async fn run_test(ctx: &ResolvedContext) -> Result<TestResult, AppError> {
    let headers = build_headers(&ctx.key)?;
    // The same `PromptSpec` path a real feature takes (Section 12: "Test
    // key" must prove the real chokepoint, not a lighter-weight variant) —
    // `ConnectivityCheck` is a fixed feature with an empty, genuinely
    // `redact()`-produced payload and no subject.
    let ping = crate::ai::prompt::build(
        crate::ai::prompt::AiFeature::ConnectivityCheck,
        crate::privacy::redact::redact(
            &crate::contract::EngineSnippetsResult { snippets: vec![] },
            &[],
        )?,
    );
    http::send(
        &ctx.permit,
        &ctx.endpoint,
        &headers,
        ProviderShape::OpenAiCompatible,
        &ctx.model,
        &ping,
    )?;
    Ok(TestResult { is_ok: true })
}

struct ResolvedContext {
    permit: EgressPermit,
    endpoint: ResolvedEndpoint,
    key: AiKey,
    model: String,
}

/// The conventional `Authorization: Bearer <key>` header every named
/// OpenAI-compatible provider (OpenAI, DeepSeek, Groq, OpenRouter,
/// Together) accepts.
fn build_headers(key: &AiKey) -> Result<RequestHeaders, AppError> {
    let mut headers = RequestHeaders::new();
    headers.insert("authorization", format!("Bearer {}", key.reveal()));
    Ok(headers)
}

/// The OpenAI chat-completions response shape:
/// `{"choices": [{"message": {"role": "assistant", "content": "..."}}]}`.
fn parse_completion_response(raw_body: &str) -> Result<CompletionResponse, AppError> {
    let value: serde_json::Value = serde_json::from_str(raw_body).map_err(|err| {
        AppError::ai_network(
            false,
            format!("unparseable response body: {err}; body={raw_body}"),
        )
    })?;
    let text = value
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|first| first.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .ok_or_else(|| {
            AppError::ai_network(false, format!("unexpected response shape: {raw_body}"))
        })?;
    Ok(CompletionResponse {
        text: text.to_string(),
    })
}

impl AiProvider for OpenAiCompatibleProvider {
    /// Identical shape to `AnthropicProvider::complete` except `ProviderShape::OpenAiCompatible`
    /// and a `Bearer` auth header.
    async fn complete(&self, req: CompletionRequest) -> Result<CompletionResponse, AppError> {
        let ctx = self.resolve_context(None)?;
        let headers = build_headers(&ctx.key)?;
        let response = http::send(
            &ctx.permit,
            &ctx.endpoint,
            &headers,
            ProviderShape::OpenAiCompatible,
            &ctx.model,
            &req.prompt,
        )?;
        parse_completion_response(&response.body)
    }

    async fn test(&self) -> Result<TestResult, AppError> {
        let ctx = self.resolve_context(None)?;
        run_test(&ctx).await
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

    // Same hand-rolled single-poll executor as `ai::anthropic::tests`.
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

            let response_body = br#"{"choices":[{"message":{"role":"assistant","content":"ok"}}]}"#;
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

    struct KeychainCleanupGuard {
        provider_key: &'static str,
        _lock: std::sync::MutexGuard<'static, ()>,
    }
    impl Drop for KeychainCleanupGuard {
        fn drop(&mut self) {
            let _ = AiKeyStore::new().clear(self.provider_key);
        }
    }

    fn enable_real_openai_compatible(
        dir: &std::path::Path,
    ) -> (std::path::PathBuf, AiKeyStore, KeychainCleanupGuard) {
        let lock = crate::secrets::ai_key::REAL_KEYCHAIN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let settings_path = dir.join("settings.json");
        let ai_keys = AiKeyStore::new();
        let key = AiKey::parse("sk-openai-compatible-adapter-test-0").unwrap();
        ai_keys
            .store(ProviderKind::OpenAiCompatible.key_str(), &key)
            .expect("store must succeed");
        assert!(
            crate::secrets::ai_key::eventually(
                || ai_keys.has_key(ProviderKind::OpenAiCompatible.key_str())
            ),
            "sanity: the real key IS there before proceeding"
        );
        update_settings_core(
            &settings_path,
            &ai_keys,
            SettingsPatch {
                ai: Some(AiSettingsPatch {
                    is_enabled: Some(true),
                    provider: Some(ProviderKind::OpenAiCompatible),
                    model: Some("deepseek-test-model".to_string()),
                    openai_compatible_base_url: Some("https://api.deepseek.com".to_string()),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )
        .expect("update_settings_core must succeed");
        let cleanup = KeychainCleanupGuard {
            provider_key: ProviderKind::OpenAiCompatible.key_str(),
            _lock: lock,
        };
        (settings_path, ai_keys, cleanup)
    }

    #[test]
    fn a_planted_secret_is_redacted_in_the_bytes_actually_sent_over_the_wire() {
        let dir = tempfile::tempdir().unwrap();
        let (settings_path, ai_keys, _cleanup) = enable_real_openai_compatible(dir.path());
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

        let provider =
            OpenAiCompatibleProvider::new(settings_path, ai_keys).with_test_endpoint(base_url);

        let result = block_on_never_pending(provider.complete(CompletionRequest {
            prompt: crate::ai::prompt::build(
                crate::ai::prompt::AiFeature::ProjectSummary,
                redacted_payload,
            ),
        }));
        assert!(result.is_ok(), "complete() failed: {:?}", result.err());

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
            "deepseek-test-model",
            &expected_snippets,
            None,
        );
    }

    #[test]
    fn test_method_reports_success_against_a_real_listener() {
        let dir = tempfile::tempdir().unwrap();
        let (settings_path, ai_keys, _cleanup) = enable_real_openai_compatible(dir.path());
        let (base_url, rx) = spawn_capturing_server();

        let provider =
            OpenAiCompatibleProvider::new(settings_path, ai_keys).with_test_endpoint(base_url);

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
        let provider = OpenAiCompatibleProvider::new(settings_path, ai_keys);

        let empty_payload =
            crate::privacy::redact::redact(&EngineSnippetsResult { snippets: vec![] }, &[])
                .unwrap();
        let result = block_on_never_pending(provider.complete(CompletionRequest {
            prompt: crate::ai::prompt::build(
                crate::ai::prompt::AiFeature::ProjectSummary,
                empty_payload,
            ),
        }));
        assert_eq!(result.unwrap_err().code, "E_AI_DISABLED");
    }
}
