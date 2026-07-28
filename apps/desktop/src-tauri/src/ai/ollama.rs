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
//! ## This adapter does not require a stored key (step 5)
//!
//! The owner's ruling: `ai::permit::acquire` means "AI on + the
//! credentials THIS provider requires," not "AI on + key always."
//! [`crate::commands::settings::AiProvider::requires_stored_key`] answers
//! `false` for Ollama — local, unauthenticated by default, nothing leaves
//! the machine at all — so `acquire` grants a permit for it on the toggle
//! alone, and `resolve_context` below never touches the keychain. This
//! adapter sends no auth header either way (`build_headers` returns empty
//! headers) — there was never a real credential for this adapter to use,
//! only a formerly-required placeholder value the old, provider-blind gate
//! insisted on. That was flagged for owner confirmation in the prior
//! report and has now been resolved this way, in the one place
//! (`requires_stored_key`) that answers "is egress allowed" for every
//! provider — not a second gate, not a branch here.

use std::path::PathBuf;

use crate::ai::endpoint::{self, ResolvedEndpoint};
use crate::ai::http::{self, ProviderShape, RequestHeaders};
use crate::ai::permit::{self, EgressPermit};
use crate::ai::pipeline::{PipelineStep, PipelineTrace, SendApproval, TraceKind};
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

        Ok(ResolvedContext {
            permit,
            endpoint,
            model,
        })
    }

    /// Section 9 Phase 12 step 5's `test_ai_key` command for Ollama: "Test
    /// key" naturally becomes a reachability test rather than a credential
    /// test here (there is no credential — see this module's doc comment)
    /// — handled coherently by routing through the exact same
    /// `resolve_context`/`run_test` shape every other provider uses, not a
    /// special case in the button or the command layer.
    pub async fn test_with_model(
        &self,
        model: &str,
        trace: &mut PipelineTrace,
        approval: SendApproval,
    ) -> Result<TestResult, AppError> {
        let ctx = self.resolve_context(Some(model))?;
        run_test(&ctx, trace, approval).await
    }
}

/// Shared by `AiProvider::test` and `OllamaProvider::test_with_model`. On
/// failure this PROPAGATES the real `AppError` from `http::send` (never
/// collapses it into a generic "false") — Section 7.4's `test_ai_key`
/// contract rejects with the specific `E_AI_*` code
/// (`{ isOk: true, latencyMs, modelEcho }` is the ONLY success shape; the
/// `isOk` field is the TypeScript literal `true`, not `boolean` — failure
/// is a rejected promise, never a differently-shaped success), so
/// `commands::ai::test_ai_key_core` needs the original code intact to
/// return the right one. The one reclassification this module does:
/// `E_AI_NETWORK` → `E_AI_OLLAMA_UNREACHABLE`, since for a local-only
/// target "the request failed at the transport level" and "Ollama isn't
/// running" are the same event in practice, and Section 10 gives the
/// latter its own literal copy.
async fn run_test(
    ctx: &ResolvedContext,
    trace: &mut PipelineTrace,
    approval: SendApproval,
) -> Result<TestResult, AppError> {
    let headers = build_headers();
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
    let result = http::send(
        &ctx.permit,
        approval,
        TraceKind::Connectivity,
        &ctx.endpoint,
        &headers,
        ProviderShape::Ollama,
        &ctx.model,
        &ping,
    );
    match result {
        Ok(_) => {
            // Recorded next to the send itself, so the step cannot drift
            // away from the thing it attests to.
            trace.record(PipelineStep::Sent);
            Ok(TestResult { is_ok: true })
        }
        Err(err) if err.code == "E_AI_NETWORK" => Err(AppError::ai_ollama_unreachable(
            &ctx.model,
            err.detail.unwrap_or_default(),
        )),
        Err(err) => Err(err),
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
    /// Identical shape to `AnthropicProvider::complete` except `ProviderShape::Ollama` and no
    /// auth header.
    async fn complete(&self, req: CompletionRequest) -> Result<CompletionResponse, AppError> {
        let ctx = self.resolve_context(None)?;
        let headers = build_headers();
        let response = http::send(
            &ctx.permit,
            req.approval,
            TraceKind::Feature,
            &ctx.endpoint,
            &headers,
            ProviderShape::Ollama,
            &ctx.model,
            &req.prompt,
        )?;
        parse_completion_response(&response.body)
    }

    async fn test(
        &self,
        trace: &mut PipelineTrace,
        approval: SendApproval,
    ) -> Result<TestResult, AppError> {
        let ctx = self.resolve_context(None)?;
        run_test(&ctx, trace, approval).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::settings::{
        update_settings_core, AiProvider as ProviderKind, AiSettingsPatch, SettingsPatch,
    };
    use crate::contract::{EngineSnippet, EngineSnippetsResult};
    use std::future::Future;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::pin::Pin;
    use std::sync::mpsc;
    use std::task::{Context, Poll, Waker};

    // Same hand-rolled single-poll executor as `ai::anthropic::tests` — see
    // that module's doc comment for why this crate doesn't add a
    // dependency to drive a future that never actually suspends.
    fn block_on_never_pending<F: Future>(future: F) -> F::Output {
        // `Waker::noop()` (stable since Rust 1.85) replaces a hand-rolled
        // no-op vtable that was duplicated verbatim across three modules.
        let mut cx = Context::from_waker(Waker::noop());
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

    /// Enables Ollama through the real settings-file machinery — and,
    /// deliberately, stores NO key anywhere. Step 5's owner ruling:
    /// `ai::permit::acquire` no longer requires one for Ollama
    /// (`AiProvider::requires_stored_key` returns `false`) — this proves
    /// that end-to-end through the real adapter, not just the permit
    /// function in isolation. No `REAL_KEYCHAIN_TEST_LOCK` needed either:
    /// with no credential requirement, Ollama's `resolve_context` never
    /// touches the keychain at all, so there is no shared resource to
    /// serialize against.
    fn enable_real_ollama(dir: &std::path::Path) -> (std::path::PathBuf, AiKeyStore) {
        let settings_path = dir.join("settings.json");
        let ai_keys = AiKeyStore::new();
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
        (settings_path, ai_keys)
    }

    /// The owner's explicit Part B requirement: "A test should demonstrate
    /// ollama's outbound bytes are redacted exactly like Anthropic's" —
    /// same planted secret, same real local listener, same strengthened
    /// full-body allow-set check as `ai::anthropic::tests`'s equivalent.
    #[test]
    fn ollamas_outbound_bytes_are_redacted_exactly_like_anthropics() {
        let dir = tempfile::tempdir().unwrap();
        let (settings_path, ai_keys) = enable_real_ollama(dir.path());
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
            approval: SendApproval::forge_for_test(TraceKind::Feature),
            prompt: crate::ai::prompt::build(
                crate::ai::prompt::AiFeature::ProjectSummary,
                redacted_payload,
            ),
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
            None,
        );
    }

    #[test]
    fn test_method_reports_success_against_a_real_listener() {
        let dir = tempfile::tempdir().unwrap();
        let (settings_path, ai_keys) = enable_real_ollama(dir.path());
        let (base_url, rx) = spawn_capturing_server();

        let provider = OllamaProvider::new(settings_path, ai_keys).with_test_endpoint(base_url);

        let mut trace = PipelineTrace::new_connectivity();
        let result = block_on_never_pending(provider.test(
            &mut trace,
            SendApproval::forge_for_test(TraceKind::Connectivity),
        ));
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
            approval: SendApproval::forge_for_test(TraceKind::Feature),
            prompt: crate::ai::prompt::build(
                crate::ai::prompt::AiFeature::ProjectSummary,
                empty_payload,
            ),
        }));
        assert_eq!(result.unwrap_err().code, "E_AI_DISABLED");
    }

    /// A connection-refused transport failure (nothing listening on the
    /// configured port — exactly what "Ollama isn't running" looks like)
    /// is reclassified from the generic `E_AI_NETWORK` to
    /// `E_AI_OLLAMA_UNREACHABLE`, with Section 10's literal copy.
    #[test]
    fn test_reclassifies_a_connection_refused_failure_as_ollama_unreachable() {
        let dir = tempfile::tempdir().unwrap();
        let (settings_path, ai_keys) = enable_real_ollama(dir.path());

        // Bind, then immediately drop — the OS reliably refuses the next
        // connection to a port nothing is listening on anymore.
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        drop(listener);

        let provider = OllamaProvider::new(settings_path, ai_keys)
            .with_test_endpoint(format!("http://{addr}"));
        let mut trace = PipelineTrace::new_connectivity();
        let result = block_on_never_pending(provider.test(
            &mut trace,
            SendApproval::forge_for_test(TraceKind::Connectivity),
        ));

        let err = result.expect_err("expected the connection to fail");
        assert_eq!(err.code, "E_AI_OLLAMA_UNREACHABLE");
        assert!(err
            .message
            .contains("Start Ollama and pull llama-test-model"));
    }

    /// `test_with_model` uses the OVERRIDE model, not whatever is
    /// currently persisted — proven against the real bytes a listener
    /// actually receives, not just the return value.
    #[test]
    fn test_with_model_sends_the_override_model_not_the_stored_one() {
        let dir = tempfile::tempdir().unwrap();
        let (settings_path, ai_keys) = enable_real_ollama(dir.path());
        let (base_url, rx) = spawn_capturing_server();

        let provider = OllamaProvider::new(settings_path, ai_keys).with_test_endpoint(base_url);
        let mut trace = PipelineTrace::new_connectivity();
        let result = block_on_never_pending(provider.test_with_model(
            "override-model",
            &mut trace,
            SendApproval::forge_for_test(TraceKind::Connectivity),
        ));
        assert!(result.is_ok(), "test_with_model failed: {:?}", result.err());

        let received_body = rx
            .recv_timeout(std::time::Duration::from_secs(15))
            .expect("the local listener never received a request");
        let received_json: serde_json::Value = serde_json::from_slice(&received_body).unwrap();
        assert_eq!(received_json["model"], "override-model");
        assert_ne!(received_json["model"], "llama-test-model");
    }
}
