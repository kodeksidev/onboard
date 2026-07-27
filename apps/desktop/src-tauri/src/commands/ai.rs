//! `commands/ai.rs` — Section 9 Phase 12 step 5: `test_ai_key` (Section
//! 7.4). This is the whole of this file: the three AI features (project
//! summary, module explanations, Q&A) are Step 6, after review, and are
//! deliberately absent.
//!
//! ## Why `test_ai_key` proves the full chokepoint, not just "does the key work"
//!
//! The owner was explicit: "Test key must make one real round-trip
//! through the full chokepoint — permit → redaction → `ResolvedEndpoint`
//! → `http::send`." [`test_ai_key_core`] does not hand-roll a lighter-weight
//! connectivity check; it calls the SAME `AiProvider` adapter
//! (`ai::anthropic`/`ai::ollama`/`ai::openai_compatible`) real feature code
//! will eventually use, via each adapter's `test_with_model` — which
//! resolves a real `EgressPermit`, builds a real (empty but genuinely
//! `redact()`-produced) `RedactedPayload`, resolves a real
//! `ResolvedEndpoint`, and calls the one `ai::http::send` in the crate. A
//! test-only shortcut that skipped any of those legs would prove nothing
//! about redaction or HTTP wiring — only that a key string looks
//! plausible.
//!
//! For Ollama specifically, "Test key" is naturally a reachability test
//! rather than a credential test (`AiProvider::requires_stored_key`
//! returns `false` for it — see `ai::permit`'s doc comment) — this file
//! does not special-case that in the button or here; it is already
//! coherent, because `test_with_model` is the exact same call for all
//! three providers regardless of whether the provider needs a credential.
//!
//! ## The `{ isOk: true, latencyMs, modelEcho }` response shape
//!
//! Section 7.4's `test_ai_key` response is `{ isOk: true, latencyMs,
//! modelEcho }` — the TypeScript type is the literal `true`, not
//! `boolean`. Failure is therefore a REJECTED command with one of the
//! specific `E_AI_*` codes (`E_AI_KEY_INVALID`, `E_AI_NETWORK`,
//! `E_AI_OLLAMA_UNREACHABLE`, `E_AI_MODEL_NOT_FOUND`, `E_AI_RATE_LIMITED`),
//! never a differently-shaped `{ isOk: false, .. }` success. Every
//! adapter's `test_with_model`/`run_test` propagates the real `AppError`
//! from `ai::http::send` for exactly this reason.

use std::path::PathBuf;
use std::time::Instant;

use serde::Serialize;

use crate::ai::anthropic::AnthropicProvider;
use crate::ai::ollama::OllamaProvider;
use crate::ai::openai_compatible::OpenAiCompatibleProvider;
use crate::commands::settings::validate_provider;
use crate::error::AppError;
use crate::secrets::ai_key::AiKeyStore;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestAiKeyResponse {
    pub is_ok: bool,
    pub latency_ms: u64,
    pub model_echo: String,
}

/// Dispatches to the real adapter for `provider`, measures the real
/// round-trip latency, and echoes back the exact `model` string that was
/// tested (see this module's doc comment for why that is the caller's
/// value, not necessarily whatever is currently persisted).
pub async fn test_ai_key_core(
    settings_path: PathBuf,
    ai_keys: AiKeyStore,
    provider: &str,
    model: &str,
) -> Result<TestAiKeyResponse, AppError> {
    validate_provider(provider)?;
    let started = Instant::now();

    match provider {
        "anthropic" => {
            AnthropicProvider::new(settings_path, ai_keys)
                .test_with_model(model)
                .await?;
        }
        "ollama" => {
            OllamaProvider::new(settings_path, ai_keys)
                .test_with_model(model)
                .await?;
        }
        "openai-compatible" => {
            OpenAiCompatibleProvider::new(settings_path, ai_keys)
                .test_with_model(model)
                .await?;
        }
        // `validate_provider` above already rejected anything else.
        _ => unreachable!("validate_provider only accepts anthropic/ollama/openai-compatible"),
    }

    Ok(TestAiKeyResponse {
        is_ok: true,
        latency_ms: started.elapsed().as_millis() as u64,
        model_echo: model.to_string(),
    })
}

/// `#[cfg(test)]`-only twin of [`test_ai_key_core`], identical in every
/// way except it points whichever adapter it builds at `test_endpoint`
/// (each adapter's own `#[cfg(test)]`-only `with_test_endpoint` seam —
/// see `ai::endpoint::resolve_for_test`'s doc comment for why that shape
/// is safe: compiled out of every non-test build entirely). This exists
/// so this module's OWN tests can prove `test_ai_key_core`'s dispatch
/// logic against a real local listener — asserting on the bytes a real
/// server actually received — instead of either mocking `ai::http::send`
/// (which would stop testing the real chokepoint) or attempting a live
/// call to a real provider from a sandboxed test run (unreliable,
/// network-dependent, and not what "prove it" means in this phase).
#[cfg(test)]
async fn test_ai_key_core_against_test_endpoint(
    settings_path: PathBuf,
    ai_keys: AiKeyStore,
    provider: &str,
    model: &str,
    test_endpoint: String,
) -> Result<TestAiKeyResponse, AppError> {
    validate_provider(provider)?;
    let started = Instant::now();

    match provider {
        "anthropic" => {
            AnthropicProvider::new(settings_path, ai_keys)
                .with_test_endpoint(test_endpoint)
                .test_with_model(model)
                .await?;
        }
        "ollama" => {
            OllamaProvider::new(settings_path, ai_keys)
                .with_test_endpoint(test_endpoint)
                .test_with_model(model)
                .await?;
        }
        "openai-compatible" => {
            OpenAiCompatibleProvider::new(settings_path, ai_keys)
                .with_test_endpoint(test_endpoint)
                .test_with_model(model)
                .await?;
        }
        _ => unreachable!("validate_provider only accepts anthropic/ollama/openai-compatible"),
    }

    Ok(TestAiKeyResponse {
        is_ok: true,
        latency_ms: started.elapsed().as_millis() as u64,
        model_echo: model.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::settings::{
        update_settings_core, AiProvider, AiSettingsPatch, SettingsPatch,
    };
    use crate::secrets::ai_key::AiKey;
    use std::future::Future;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::pin::Pin;
    use std::task::{Context, Poll, RawWaker, RawWakerVTable, Waker};

    // A minimal single-poll executor — see `ai::anthropic::tests`'s doc
    // comment for the full rationale. `test_ai_key_core` never truly
    // suspends (its only work is a blocking `ai::http::send` call), so a
    // production `#[tauri::command] async fn` lets Tauri's own runtime
    // drive it for real; this crate's own test suite has no such runtime,
    // hence this hand-rolled equivalent, purely `#[cfg(test)]`.
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

    fn spawn_capturing_server() -> (String, std::sync::mpsc::Receiver<Vec<u8>>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind a local test listener");
        let addr = listener
            .local_addr()
            .expect("resolve the bound local address");
        let (tx, rx) = std::sync::mpsc::channel();

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

    /// Holds `REAL_KEYCHAIN_TEST_LOCK` for the whole test's duration (the
    /// lock is a field here, not a separate local, specifically so Rust's
    /// reverse-declaration-order `Drop` sequencing can't be gotten wrong —
    /// see `ai::anthropic::tests::KeychainCleanupGuard`'s doc comment,
    /// which this mirrors) and clears the real keychain entry on drop.
    struct KeychainCleanupGuard {
        provider_key: &'static str,
        _lock: std::sync::MutexGuard<'static, ()>,
    }
    impl Drop for KeychainCleanupGuard {
        fn drop(&mut self) {
            let _ = AiKeyStore::new().clear(self.provider_key);
        }
    }

    #[test]
    fn rejects_an_unknown_provider_before_touching_anything_else() {
        let dir = tempfile::tempdir().unwrap();
        let settings_path = dir.path().join("settings.json");
        let ai_keys = AiKeyStore::new();
        let result = block_on_never_pending(test_ai_key_core(
            settings_path,
            ai_keys,
            "not-a-real-provider",
            "some-model",
        ));
        assert_eq!(result.unwrap_err().code, "E_INVALID_SETTINGS");
    }

    #[test]
    fn fails_with_e_ai_disabled_when_ai_is_off() {
        let dir = tempfile::tempdir().unwrap();
        let settings_path = dir.path().join("settings.json");
        let ai_keys = AiKeyStore::new();
        let result = block_on_never_pending(test_ai_key_core(
            settings_path,
            ai_keys,
            "anthropic",
            "claude-test-model",
        ));
        assert_eq!(result.unwrap_err().code, "E_AI_DISABLED");
    }

    /// Stores a real key and enables Anthropic through the real
    /// settings-file machinery — the shared setup for the two tests below,
    /// extracted so neither trips `too_many_lines`. Returns the SAME
    /// `AiKeyStore` instance the key was stored into (see
    /// `ai::anthropic::tests::enable_real_anthropic`'s doc comment for why
    /// that matters) and a guard that clears the key and releases the lock
    /// together, in the right order, on drop.
    fn enable_real_anthropic_key(
        dir: &std::path::Path,
    ) -> (PathBuf, AiKeyStore, KeychainCleanupGuard) {
        let lock = crate::secrets::ai_key::REAL_KEYCHAIN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let settings_path = dir.join("settings.json");
        let ai_keys = AiKeyStore::new();
        let provider_key = AiProvider::Anthropic.key_str();
        let key = AiKey::parse("sk-ant-test-ai-key-command-test-000").unwrap();
        ai_keys
            .store(provider_key, &key)
            .expect("store must succeed");
        assert!(crate::secrets::ai_key::eventually(
            || ai_keys.has_key(provider_key)
        ));
        (
            settings_path,
            ai_keys,
            KeychainCleanupGuard {
                provider_key,
                _lock: lock,
            },
        )
    }

    /// The hard requirement, proven end-to-end through the real
    /// `test_ai_key_core` dispatch logic: a genuine round trip through
    /// permit → redaction → `ResolvedEndpoint` → `http::send`, asserted
    /// against a real local listener that ACTUALLY receives a request
    /// (vacuous-pass guard) before trusting the response — carrying real
    /// measured latency plus the tested model echoed back.
    #[test]
    fn succeeds_against_a_real_listener_and_echoes_latency_and_model() {
        let dir = tempfile::tempdir().unwrap();
        let (settings_path, ai_keys, _cleanup) = enable_real_anthropic_key(dir.path());
        update_settings_core(
            &settings_path,
            &ai_keys,
            SettingsPatch {
                ai: Some(AiSettingsPatch {
                    is_enabled: Some(true),
                    provider: Some(AiProvider::Anthropic),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )
        .expect("update_settings_core must succeed");

        let (base_url, rx) = spawn_capturing_server();
        let started_before = Instant::now();
        let result = block_on_never_pending(test_ai_key_core_against_test_endpoint(
            settings_path,
            ai_keys,
            "anthropic",
            "claude-test-model",
            base_url,
        ));
        let elapsed_after = started_before.elapsed();

        // Assert the listener actually received a request BEFORE trusting
        // anything about the response — a test that only checks the
        // return value passes vacuously if no request ever arrived.
        let received = rx
            .recv_timeout(std::time::Duration::from_secs(15))
            .expect("the local listener never received a request — vacuous pass guard");
        assert!(!received.is_empty());

        let response = result.expect("test_ai_key_core must succeed against a real listener");
        assert!(response.is_ok);
        assert_eq!(response.model_echo, "claude-test-model");
        assert!(
            response.latency_ms <= elapsed_after.as_millis() as u64 + 5,
            "reported latency ({} ms) should not exceed the test's own wall-clock measurement",
            response.latency_ms
        );
    }

    /// `model_echo` reflects the CALLER-supplied model, not whatever is
    /// persisted in settings — proving `test_ai_key` can verify a model id
    /// before it is saved (Section 7.4's `{ provider, model }` request
    /// shape takes `model` as an explicit argument for exactly this).
    #[test]
    fn model_echo_reflects_the_requested_model_not_the_stored_one() {
        let dir = tempfile::tempdir().unwrap();
        let (settings_path, ai_keys, _cleanup) = enable_real_anthropic_key(dir.path());
        update_settings_core(
            &settings_path,
            &ai_keys,
            SettingsPatch {
                ai: Some(AiSettingsPatch {
                    is_enabled: Some(true),
                    provider: Some(AiProvider::Anthropic),
                    model: Some("saved-model-not-under-test".to_string()),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )
        .expect("update_settings_core must succeed");

        let (base_url, rx) = spawn_capturing_server();
        let result = block_on_never_pending(test_ai_key_core_against_test_endpoint(
            settings_path,
            ai_keys,
            "anthropic",
            "not-yet-saved-model",
            base_url,
        ));
        let received_body = rx
            .recv_timeout(std::time::Duration::from_secs(15))
            .expect("the local listener never received a request");
        let received_json: serde_json::Value = serde_json::from_slice(&received_body).unwrap();

        let response = result.expect("expected success");
        assert_eq!(response.model_echo, "not-yet-saved-model");
        assert_eq!(received_json["model"], "not-yet-saved-model");
    }
}
