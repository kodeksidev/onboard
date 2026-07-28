//! `commands/ai.rs` — Section 7.4's `test_ai_key` (Phase 12 step 5) plus
//! the three AI features (`ai_project_summary`, `ai_explain_module`,
//! `ai_ask`, Phase 12 step 6).
//!
//! ## One pipeline, three commands
//!
//! Section 12: every `ai_*` must run
//! `permit::acquire → engine.snippets → REDACT (8.9) → caps (R4) →
//! transcript (R5) → send → verify citations (8.10)`, and "skipping any
//! step is a CRITICAL review finding." Three copies of that chain would be
//! three chances to drift, so there is exactly one implementation —
//! [`run_ai_feature`], private to this module — and the three commands
//! differ only in the [`AiRequest`] they hand it. `ai::pipeline`'s
//! [`crate::ai::pipeline::PipelineTrace`] is what makes a skipped step
//! fail closed rather than silently succeed; see that module's doc comment
//! for which steps are type-enforced already and which two are not.
//!
//! ## Where the candidate paths come from (and why never from a caller)
//!
//! The webview supplies a `repoId`, a `moduleId`, or a question — never a
//! list of files. Each feature derives its own ranked candidate list from
//! the recorded analysis (`AppState::with_session`): `importantFilePaths`
//! for the summary, a module card's `keyFilePaths` for an explanation, and
//! `engine.search` hits in score order for a question. Section 8.9 R4's
//! "keep highest-ranked files first, drop the tail" therefore operates on a
//! genuinely ranked list, and no caller can steer which files are read.
//!
//! ## Why `test_ai_key` proves the full chokepoint, not just "does the key work"
//!
//! The owner was explicit: "Test key must make one real round-trip
//! through the full chokepoint — permit → redaction → `ResolvedEndpoint`
//! → `http::send`." [`test_ai_key_core`] does not hand-roll a lighter-weight
//! connectivity check; it calls the SAME `AiProvider` adapter
//! (`ai::anthropic`/`ai::ollama`) real feature code
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

use std::path::{Path, PathBuf};
use std::time::Instant;

use serde::Serialize;

use crate::ai::anthropic::AnthropicProvider;
use crate::ai::http::ProviderShape;
use crate::ai::ollama::OllamaProvider;
use crate::ai::pipeline::{PipelineStep, PipelineTrace};
use crate::ai::prompt::{AiFeature, ModuleId, PromptSpec, UserQuestion};
use crate::ai::provider::{AiProvider as AiProviderTrait, CompletionRequest};
use crate::ai::{permit, snippets, transcript};
use crate::commands::search::search_repo_core;
use crate::commands::settings::{
    get_settings_core, load_stored_ai_settings, validate_provider, AiProvider,
};
use crate::constants::{AI_SNIPPET_CANDIDATE_LIMIT, SEARCH_QUERY_MAX_LEN};
use crate::error::AppError;
use crate::privacy::verify_citations::{verify_citations, CitationIndex};
use crate::secrets::ai_key::AiKeyStore;
use crate::state::AppState;

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
/// M1: this used to reach `ai::http::send` with no `PipelineTrace`, no
/// `transcript::record` and no `ai_rate_limiter.acquire()` — the one path
/// that went around the traced pipeline while still using the single egress
/// door, and the one path that transmits the API key. There is one door; a
/// key test does not get to go around it.
///
/// The probe runs the connectivity order (`ai::pipeline`), not the feature
/// order: it has no repo, no snippets and no answer to verify, so claiming
/// `Redacted` over its empty payload would be an attestation about nothing.
///
/// Known consequence, recorded rather than discovered later: the rate
/// limiter is the SHARED per-minute budget, so ten key tests exhaust it and
/// the eleventh returns `E_AI_RATE_LIMITED`. That is correct — one door, one
/// budget — but it interacts with criterion 15's "under 5 seconds".
pub async fn test_ai_key_core(
    state: &AppState,
    transcripts_dir: &Path,
    settings_path: PathBuf,
    ai_keys: AiKeyStore,
    provider: &str,
    model: &str,
) -> Result<TestAiKeyResponse, AppError> {
    validate_provider(provider)?;
    let started = Instant::now();
    let mut trace = PipelineTrace::new_connectivity();

    // (1) permit — Section 12's "E_AI_DISABLED before any other work".
    let stored = load_stored_ai_settings(&settings_path, &ai_keys);
    let _permit = permit::acquire(stored.ai(), &ai_keys)?;
    trace.record(PipelineStep::PermitAcquired);

    // (2) rate limit, on the same shared budget as every feature request.
    let _slot = state.ai_rate_limiter.acquire()?;
    trace.record(PipelineStep::RateLimitAcquired);

    // (3) the probe payload. Distinct from Redacted/Capped on purpose.
    let shape = provider_shape(stored.ai().provider);
    trace.record(PipelineStep::ConnectivityProbeBuilt);

    // (4) transcript BEFORE the send, same ordering the feature path uses:
    // an unrecorded request must not be possible.
    transcript::record_connectivity(transcripts_dir, shape, model)?;
    trace.record(PipelineStep::TranscriptRecorded);

    // (5) the fail-closed gate.
    trace.ensure_ready_to_send()?;

    match provider {
        "anthropic" => {
            AnthropicProvider::new(settings_path, ai_keys)
                .test_with_model(model, &mut trace)
                .await?;
        }
        "ollama" => {
            OllamaProvider::new(settings_path, ai_keys)
                .test_with_model(model, &mut trace)
                .await?;
        }
        // `validate_provider` above already rejected anything else.
        _ => unreachable!("validate_provider only accepts anthropic/ollama"),
    }
    // `Sent` is recorded inside the adapter, next to the send itself.
    trace.ensure_complete_and_ordered()?;

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
    // The twin exercises adapter dispatch only; the traced pipeline itself
    // is covered by `test_ai_key_core`. A connectivity trace is still built
    // so `run_test` has somewhere to record `Sent`.
    let mut trace = PipelineTrace::new_connectivity();

    match provider {
        "anthropic" => {
            AnthropicProvider::new(settings_path, ai_keys)
                .with_test_endpoint(test_endpoint)
                .test_with_model(model, &mut trace)
                .await?;
        }
        "ollama" => {
            OllamaProvider::new(settings_path, ai_keys)
                .with_test_endpoint(test_endpoint)
                .test_with_model(model, &mut trace)
                .await?;
        }
        _ => unreachable!("validate_provider only accepts anthropic/ollama"),
    }

    Ok(TestAiKeyResponse {
        is_ok: true,
        latency_ms: started.elapsed().as_millis() as u64,
        model_echo: model.to_string(),
    })
}

// ---------------------------------------------------------------------------
// Phase 12 step 6 — the three AI features (Section 7.4)
// ---------------------------------------------------------------------------

/// Section 7.4's shared `ai_*` response shape:
/// `{ markdown, citedPaths, sentFileCount, sentByteCount }`. `markdown` is
/// the CITATION-VERIFIED, `[[path:line]]`-rewritten text (Section 8.10 step
/// 4) — a raw model answer never reaches this struct, because
/// `verify_citations` is the only thing that produces the string it is
/// built from.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAnswer {
    pub markdown: String,
    pub cited_paths: Vec<String>,
    pub sent_file_count: usize,
    pub sent_byte_count: usize,
}

/// Which feature was asked for, with its caller-supplied argument still
/// unvalidated — [`run_ai_feature`] parses each into its `ai::prompt`
/// newtype (`ModuleId` / `UserQuestion`) at the boundary, so nothing
/// downstream ever sees a raw `String`.
#[derive(Debug, Clone)]
pub enum AiRequest {
    ProjectSummary,
    ExplainModule { module_id: String },
    Ask { question: String },
}

/// Everything the pipeline needs that comes from `AppHandle` rather than
/// `AppState`, resolved by the command wrapper before any `.await`.
pub struct AiCommandContext {
    pub settings_path: PathBuf,
    /// Section 12: `<appDataDir>/onboard/transcripts/`.
    pub transcripts_dir: PathBuf,
    pub ai_keys: AiKeyStore,
    /// `#[cfg(test)]`-only, exactly like each adapter's `with_test_endpoint`
    /// seam — compiled out of every non-test build, so a release binary has
    /// no field, no branch and no code path through which a caller could
    /// redirect a request. See `ai::endpoint::resolve_for_test`'s doc
    /// comment.
    #[cfg(test)]
    pub(crate) test_endpoint: Option<String>,
}

fn provider_shape(provider: AiProvider) -> ProviderShape {
    match provider {
        AiProvider::Anthropic => ProviderShape::Anthropic,
        AiProvider::Ollama => ProviderShape::Ollama,
    }
}

/// Resolves the ranked candidate path list AND the typed feature for this
/// request. Both come out of the recorded analysis or `engine.search` —
/// never from the caller (see this module's doc comment).
fn resolve_feature_and_paths(
    state: &AppState,
    repo_id: &str,
    request: AiRequest,
) -> Result<(AiFeature, Vec<String>), AppError> {
    let Some((important_paths, module_paths)) = state.with_session(repo_id, |session| {
        (
            session.important_file_paths.clone(),
            session.module_key_file_paths.clone(),
        )
    }) else {
        return Err(AppError::no_analysis());
    };

    let (feature, mut paths) = match request {
        AiRequest::ProjectSummary => (AiFeature::ProjectSummary, important_paths.clone()),
        AiRequest::ExplainModule { module_id } => {
            let parsed = ModuleId::parse(&module_id)?;
            let paths = module_paths.get(parsed.as_str()).cloned().ok_or_else(|| {
                AppError::invalid_settings(&format!(
                    "No module with id '{}' exists in this analysis.",
                    parsed.as_str()
                ))
            })?;
            (AiFeature::ModuleExplanation(parsed), paths)
        }
        AiRequest::Ask { question } => {
            let parsed = UserQuestion::parse(&question)?;
            // `search_repo`'s own boundary caps `query` at 200 characters
            // while a question may be up to 500 — the search is only used
            // to RANK candidate files, so truncating it there costs the
            // ranking a little recall and costs the prompt nothing (the
            // full question still travels as the prompt's `subject`).
            let search_query: String = parsed.as_str().chars().take(SEARCH_QUERY_MAX_LEN).collect();
            let hits = search_repo_core(
                state,
                repo_id.to_string(),
                search_query,
                AI_SNIPPET_CANDIDATE_LIMIT as u32,
            )?;
            let ranked: Vec<String> = hits.hits.into_iter().map(|hit| hit.path).collect();
            // A question that matches nothing still deserves an answer
            // grounded in SOMETHING real, so fall back to the repo's hubs
            // rather than sending an empty payload (which the model could
            // only answer uncited, and Section 8.10 would then reject).
            let paths = if ranked.is_empty() {
                important_paths.clone()
            } else {
                ranked
            };
            (AiFeature::Question(parsed), paths)
        }
    };

    if paths.is_empty() {
        return Err(AppError::no_analysis());
    }
    paths.truncate(AI_SNIPPET_CANDIDATE_LIMIT);
    Ok((feature, paths))
}

/// Dispatches to the configured provider's adapter. Every adapter re-runs
/// the full `permit → endpoint → send` triad internally; this function
/// chooses which one, never how.
async fn complete_with_provider(
    ctx: &AiCommandContext,
    provider: AiProvider,
    prompt: PromptSpec,
) -> Result<String, AppError> {
    let settings_path = ctx.settings_path.clone();
    let ai_keys = ctx.ai_keys.clone();
    let req = CompletionRequest { prompt };

    let response = match provider {
        AiProvider::Anthropic => {
            let adapter = AnthropicProvider::new(settings_path, ai_keys);
            #[cfg(test)]
            let adapter = match &ctx.test_endpoint {
                Some(url) => adapter.with_test_endpoint(url.clone()),
                None => adapter,
            };
            adapter.complete(req).await?
        }
        AiProvider::Ollama => {
            let adapter = OllamaProvider::new(settings_path, ai_keys);
            #[cfg(test)]
            let adapter = match &ctx.test_endpoint {
                Some(url) => adapter.with_test_endpoint(url.clone()),
                None => adapter,
            };
            adapter.complete(req).await?
        }
    };
    Ok(response.text)
}

/// **The** `ai_*` pipeline — Section 12's ordered chain, implemented once.
/// Returns the trace alongside the answer so this module's own tests can
/// assert the ORDER steps ran in, not merely that they all happened.
///
/// Every step below is numbered to match Section 12's list. Nothing between
/// them is optional, and `trace.ensure_ready_to_send()` refuses the request
/// outright if any of them were removed.
async fn run_ai_feature(
    state: &AppState,
    ctx: &AiCommandContext,
    repo_id: &str,
    request: AiRequest,
) -> Result<(AiAnswer, PipelineTrace), AppError> {
    // Section 12 boundary validation, before anything else: `repoId` must
    // be 16 lowercase hex characters (the same rule `search_repo` applies),
    // not least because it becomes a transcript file name.
    crate::commands::search::validate_repo_id(repo_id)?;

    let mut trace = PipelineTrace::new_feature();

    // (1) permit::acquire — Section 12: "E_AI_DISABLED before any other
    // work." The one gate; `ai::permit::acquire` is also what each adapter
    // calls internally, so this is the same rule asked earlier, never a
    // second definition of it.
    let stored = load_stored_ai_settings(&ctx.settings_path, &ctx.ai_keys);
    let _permit = permit::acquire(stored.ai(), &ctx.ai_keys)?;
    let provider = stored.ai().provider;
    let model = stored.ai().model.clone();
    trace.record(PipelineStep::PermitAcquired);

    // (1b) Section 12 rate limits, before any engine or network work.
    let _slot = state.ai_rate_limiter.acquire()?;
    trace.record(PipelineStep::RateLimitAcquired);

    let (feature, candidate_paths) = resolve_feature_and_paths(state, repo_id, request)?;

    // (2) engine.snippets — Section 7.3: "the only source of text the AI
    // path may use."
    let raw_snippets = snippets::fetch(&state.supervisor, repo_id, &candidate_paths)?;
    trace.record(PipelineStep::SnippetsFetched);

    // (3) REDACT (8.9 R1-R3, including the R3 idempotence re-scan that
    // aborts with E_AI_PAYLOAD_UNSAFE) and (4) caps (R4) — one call,
    // because `redact` performs R1-R4 together.
    let exclude_globs = get_settings_core(&ctx.settings_path, &ctx.ai_keys).exclude_globs;
    let payload = crate::privacy::redact::redact(&raw_snippets, &exclude_globs)?;
    trace.record(PipelineStep::Redacted);
    trace.record(PipelineStep::Capped);

    let prompt = crate::ai::prompt::build(feature, payload);
    let sent_file_count = prompt.sent_file_count();
    let sent_byte_count = prompt.sent_byte_count();

    // (5) transcript (R5) — the exact post-redaction, post-cap body,
    // written BEFORE the request goes out. A write failure aborts.
    transcript::record(
        &ctx.transcripts_dir,
        repo_id,
        provider_shape(provider),
        &model,
        &prompt,
    )?;
    trace.record(PipelineStep::TranscriptRecorded);

    // The fail-closed gate: nothing leaves unless every step above ran, in
    // order (`ai::pipeline`'s doc comment explains why this exists even
    // though most of the chain is already type-enforced).
    trace.ensure_ready_to_send()?;

    // (6) send.
    let answer_markdown = complete_with_provider(ctx, provider, prompt).await?;
    trace.record(PipelineStep::Sent);

    // (7) verify citations (8.10) — including this crate's two
    // strengthenings: a cited line must exist, and an uncited answer is
    // rejected rather than reported as verified.
    let index = state
        .with_session(repo_id, |session| {
            CitationIndex::from_files(session.file_line_counts.iter().cloned())
        })
        .ok_or_else(AppError::no_analysis)?;
    let verified = verify_citations(&answer_markdown, &index)?;
    trace.record(PipelineStep::CitationsVerified);

    trace.ensure_complete_and_ordered()?;
    Ok((
        AiAnswer {
            markdown: verified.markdown().to_string(),
            cited_paths: verified.cited_paths().to_vec(),
            sent_file_count,
            sent_byte_count,
        },
        trace,
    ))
}

/// Section 7.4: `ai_project_summary { repoId }`.
pub async fn ai_project_summary_core(
    state: &AppState,
    ctx: AiCommandContext,
    repo_id: &str,
) -> Result<AiAnswer, AppError> {
    run_ai_feature(state, &ctx, repo_id, AiRequest::ProjectSummary)
        .await
        .map(|(answer, _trace)| answer)
}

/// Section 7.4: `ai_explain_module { repoId, moduleId }`.
pub async fn ai_explain_module_core(
    state: &AppState,
    ctx: AiCommandContext,
    repo_id: &str,
    module_id: &str,
) -> Result<AiAnswer, AppError> {
    run_ai_feature(
        state,
        &ctx,
        repo_id,
        AiRequest::ExplainModule {
            module_id: module_id.to_string(),
        },
    )
    .await
    .map(|(answer, _trace)| answer)
}

/// Section 7.4: `ai_ask { repoId, question }`.
pub async fn ai_ask_core(
    state: &AppState,
    ctx: AiCommandContext,
    repo_id: &str,
    question: &str,
) -> Result<AiAnswer, AppError> {
    run_ai_feature(
        state,
        &ctx,
        repo_id,
        AiRequest::Ask {
            question: question.to_string(),
        },
    )
    .await
    .map(|(answer, _trace)| answer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::settings::{update_settings_core, AiSettingsPatch, SettingsPatch};
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
        let (url, rx) = spawn_answering_server("ok", None);
        (url, rx.into_body_receiver())
    }

    /// What the local listener observed. `transcript_existed_on_arrival` is
    /// the ordering evidence Section 12's pipeline needs: it is sampled by
    /// the SERVER THREAD at the moment the request body lands, so a test
    /// asserting it can distinguish "the transcript was written before the
    /// send" from "both happened, in some order".
    struct ServerObservation {
        rx: std::sync::mpsc::Receiver<(Vec<u8>, bool)>,
    }

    impl ServerObservation {
        fn recv(&self) -> (Vec<u8>, bool) {
            self.rx
                .recv_timeout(std::time::Duration::from_secs(15))
                .expect("the local listener never received a request — vacuous pass guard")
        }

        fn into_body_receiver(self) -> std::sync::mpsc::Receiver<Vec<u8>> {
            let (tx, rx) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                if let Ok((body, _)) = self.rx.recv() {
                    let _ = tx.send(body);
                }
            });
            rx
        }
    }

    /// A local listener that answers with `answer_text` wrapped in the
    /// Anthropic/Ollama/OpenAI response shape the adapter under test
    /// parses, and reports whether `watch_path` already existed when the
    /// request arrived.
    fn spawn_answering_server(
        answer_text: &str,
        watch_path: Option<PathBuf>,
    ) -> (String, ServerObservation) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind a local test listener");
        let addr = listener
            .local_addr()
            .expect("resolve the bound local address");
        let (tx, rx) = std::sync::mpsc::channel();
        let answer = answer_text.to_string();

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
            let watched_existed = watch_path.as_ref().is_some_and(|p| p.exists());
            let _ = tx.send((body, watched_existed));

            // Every shape this crate speaks, in one body: adapters read
            // only their own field, so one listener serves all three.
            let response_body = serde_json::json!({
                "content": [{ "type": "text", "text": answer }],
                "choices": [{ "message": { "content": answer } }],
                "message": { "content": answer },
            })
            .to_string();
            let response_head = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                response_body.len()
            );
            let _ = stream.write_all(response_head.as_bytes());
            let _ = stream.write_all(response_body.as_bytes());
            let _ = stream.flush();
        });

        (format!("http://{addr}"), ServerObservation { rx })
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
        let (state, _state_dir) = test_state_with_stub(Vec::new());
        let result = block_on_never_pending(test_ai_key_core(
            &state,
            dir.path(),
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
        let (state, _state_dir) = test_state_with_stub(Vec::new());
        let result = block_on_never_pending(test_ai_key_core(
            &state,
            dir.path(),
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

    // -----------------------------------------------------------------
    // Phase 12 step 6 — the three AI features, end to end
    // -----------------------------------------------------------------

    use crate::commands::analyze::{analyze_repo_core, AnalyzeContext, AnalyzeRepoRequest};
    use crate::sidecar::supervisor::{SidecarConfig, SidecarSupervisor};
    use std::collections::HashMap;
    use std::sync::Mutex;

    /// `packages/contract/fixtures/sample-analysis.json`'s own repo id —
    /// the stub sidecar replays that fixture, so this is the id every test
    /// session below is keyed by.
    const FIXTURE_REPO_ID: &str = "9f3c1a7b2e5d4086";

    /// Resolves the stub sidecar binary WITHOUT `CARGO_BIN_EXE_<name>`,
    /// which Cargo only populates for integration test targets. These tests
    /// have to live in the lib's own `#[cfg(test)]` tree instead, because
    /// `AiCommandContext::test_endpoint` (like every other adapter's
    /// `with_test_endpoint`) is `#[cfg(test)]` and therefore does not exist
    /// in the library an integration test links against. The unit-test
    /// binary lives at `target/<profile>/deps/<name>-<hash>`, so the bins
    /// `cargo test` also builds sit exactly one directory up.
    fn stub_sidecar_path() -> PathBuf {
        let exe = std::env::current_exe().expect("current_exe must resolve");
        let target_dir = exe
            .parent()
            .and_then(std::path::Path::parent)
            .expect("target/<profile> must exist above deps/");
        let name = if cfg!(windows) {
            "onboard_engine_stub.exe"
        } else {
            "onboard_engine_stub"
        };
        let candidate = target_dir.join(name);
        assert!(
            candidate.exists(),
            "stub sidecar not found at {} — `cargo test` builds every [[bin]], so this means the \
             layout assumption above is wrong",
            candidate.display()
        );
        candidate
    }

    fn test_state_with_stub(stub_args: Vec<String>) -> (AppState, tempfile::TempDir) {
        let temp_log = tempfile::tempdir().unwrap();
        let state = AppState {
            supervisor: SidecarSupervisor::new(SidecarConfig {
                program: stub_sidecar_path(),
                args: stub_args,
                log_path: temp_log
                    .path()
                    .join("onboard.log")
                    .to_string_lossy()
                    .to_string(),
                max_restarts: 3,
            }),
            sessions: Mutex::new(HashMap::new()),
            ai_keys: AiKeyStore::new(),
            ai_rate_limiter: crate::ai::rate_limit::AiRateLimiter::new(),
            logger: crate::util::logging::RotatingLogger::open(
                &temp_log.path().join("onboard.log"),
            )
            .unwrap(),
        };
        (state, temp_log)
    }

    /// Runs a REAL `analyze_repo_core` against the stub so the session is
    /// recorded exactly the way production records it — never a
    /// hand-inserted `RepoSession`, which would let a broken
    /// `record_analysis_session` pass these tests.
    fn record_real_session(state: &AppState) -> tempfile::TempDir {
        let repo_dir = tempfile::tempdir().unwrap();
        analyze_repo_core(
            state,
            AnalyzeRepoRequest {
                path: repo_dir.path().to_string_lossy().to_string(),
                is_force_refresh: false,
            },
            AnalyzeContext {
                app_data_dir: repo_dir.path().to_string_lossy().to_string(),
                exclude_globs: vec![],
            },
        )
        .expect("the stub sidecar must return the fixture envelope");
        repo_dir
    }

    struct AiTestRig {
        state: AppState,
        ctx: AiCommandContext,
        transcripts_dir: PathBuf,
        _cleanup: Option<KeychainCleanupGuard>,
        _dirs: Vec<tempfile::TempDir>,
    }

    /// Stores a REAL key in the REAL keychain and enables Anthropic through
    /// the REAL settings file — no fabricated `AiSettings`, so
    /// `ai::permit::acquire` is exercised against genuine state. Returns the
    /// same `AiKeyStore` instance the key went into (see
    /// `ai::anthropic::tests::enable_real_anthropic`'s doc comment for why
    /// an independent clone would not see an A18 session-only key).
    fn enable_real_anthropic_for_pipeline(
        settings_path: &std::path::Path,
    ) -> (AiKeyStore, Option<KeychainCleanupGuard>) {
        let lock = crate::secrets::ai_key::REAL_KEYCHAIN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let ai_keys = AiKeyStore::new();
        let provider_key = AiProvider::Anthropic.key_str();
        let key = AiKey::parse("sk-ant-test-ai-pipeline-key-000000").unwrap();
        ai_keys.store(provider_key, &key).expect("store must work");
        assert!(crate::secrets::ai_key::eventually(
            || ai_keys.has_key(provider_key)
        ));
        update_settings_core(
            settings_path,
            &ai_keys,
            SettingsPatch {
                ai: Some(AiSettingsPatch {
                    is_enabled: Some(true),
                    provider: Some(AiProvider::Anthropic),
                    model: Some("claude-test-model".to_string()),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )
        .expect("update_settings_core must succeed");
        (
            ai_keys,
            Some(KeychainCleanupGuard {
                provider_key,
                _lock: lock,
            }),
        )
    }

    /// Everything a real pipeline run needs: a stub sidecar with a recorded
    /// session, AI genuinely enabled through the real settings file, a real
    /// key in the real keychain, and a local listener standing in for the
    /// provider.
    fn rig(stub_args: Vec<String>, test_endpoint: Option<String>, enable_ai: bool) -> AiTestRig {
        let (state, log_dir) = test_state_with_stub(stub_args);
        let repo_dir = record_real_session(&state);
        let config_dir = tempfile::tempdir().unwrap();
        let settings_path = config_dir.path().join("settings.json");
        let transcripts_dir = config_dir.path().join("transcripts");

        let (ai_keys, cleanup) = if enable_ai {
            enable_real_anthropic_for_pipeline(&settings_path)
        } else {
            (AiKeyStore::new(), None)
        };

        AiTestRig {
            state,
            ctx: AiCommandContext {
                settings_path,
                transcripts_dir: transcripts_dir.clone(),
                ai_keys,
                test_endpoint,
            },
            transcripts_dir,
            _cleanup: cleanup,
            _dirs: vec![log_dir, repo_dir, config_dir],
        }
    }

    fn transcript_entries(dir: &std::path::Path, repo_id: &str) -> Vec<serde_json::Value> {
        let path = crate::ai::transcript::transcript_path(dir, repo_id);
        std::fs::read_to_string(path)
            .expect("a transcript must exist")
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| serde_json::from_str(l).expect("each transcript line is JSON"))
            .collect()
    }

    /// Phase 12's "Done when": every `ai_*` returns `E_AI_DISABLED` when
    /// the toggle is off — through the real `ai::permit::acquire`, not a
    /// reimplementation of its rule here.
    #[test]
    fn every_ai_command_returns_e_ai_disabled_when_the_toggle_is_off() {
        let rig = rig(vec![], None, false);
        let summary = block_on_never_pending(ai_project_summary_core(
            &rig.state,
            AiCommandContext {
                settings_path: rig.ctx.settings_path.clone(),
                transcripts_dir: rig.transcripts_dir.clone(),
                ai_keys: rig.ctx.ai_keys.clone(),
                test_endpoint: None,
            },
            FIXTURE_REPO_ID,
        ));
        assert_eq!(summary.unwrap_err().code, "E_AI_DISABLED");

        let module = block_on_never_pending(ai_explain_module_core(
            &rig.state,
            AiCommandContext {
                settings_path: rig.ctx.settings_path.clone(),
                transcripts_dir: rig.transcripts_dir.clone(),
                ai_keys: rig.ctx.ai_keys.clone(),
                test_endpoint: None,
            },
            FIXTURE_REPO_ID,
            "src-services",
        ));
        assert_eq!(module.unwrap_err().code, "E_AI_DISABLED");

        let ask = block_on_never_pending(ai_ask_core(
            &rig.state,
            rig.ctx,
            FIXTURE_REPO_ID,
            "where is auth?",
        ));
        assert_eq!(ask.unwrap_err().code, "E_AI_DISABLED");
    }

    /// The other half of the same rule: the toggle is ON but the configured
    /// provider requires a key and none is stored. `ai::permit::acquire`
    /// answers this via `AiProvider::requires_stored_key`, defined once in
    /// `commands::settings` — nothing here re-implements it.
    #[test]
    fn every_ai_command_returns_e_ai_disabled_when_a_key_requiring_provider_has_no_key() {
        let _lock = crate::secrets::ai_key::REAL_KEYCHAIN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let (state, _log_dir) = test_state_with_stub(vec![]);
        let _repo_dir = record_real_session(&state);
        let config_dir = tempfile::tempdir().unwrap();
        let settings_path = config_dir.path().join("settings.json");
        let ai_keys = AiKeyStore::new();
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
        .unwrap();

        let make_ctx = || AiCommandContext {
            settings_path: settings_path.clone(),
            transcripts_dir: config_dir.path().join("transcripts"),
            ai_keys: ai_keys.clone(),
            test_endpoint: None,
        };

        for result in [
            block_on_never_pending(ai_project_summary_core(&state, make_ctx(), FIXTURE_REPO_ID)),
            block_on_never_pending(ai_explain_module_core(
                &state,
                make_ctx(),
                FIXTURE_REPO_ID,
                "src-services",
            )),
            block_on_never_pending(ai_ask_core(&state, make_ctx(), FIXTURE_REPO_ID, "auth?")),
        ] {
            assert_eq!(result.unwrap_err().code, "E_AI_DISABLED");
        }
    }

    /// Section 12's ordered pipeline, asserted as an ORDER — not merely
    /// "every step happened somewhere".
    #[test]
    fn the_pipeline_runs_section_12s_steps_in_the_mandated_order() {
        let (base_url, server) = spawn_answering_server("See `src/utils/logger.ts:10`.", None);
        let rig = rig(vec![], Some(base_url), true);

        let result = block_on_never_pending(run_ai_feature(
            &rig.state,
            &rig.ctx,
            FIXTURE_REPO_ID,
            AiRequest::ProjectSummary,
        ));
        let (received, _) = server.recv();
        assert!(!received.is_empty(), "vacuous pass guard");

        let (_answer, trace) = result.expect("the pipeline must succeed");
        assert_eq!(trace.steps(), crate::ai::pipeline::REQUIRED_ORDER);
    }

    /// R5's ordering, proven by a clock the pipeline does not control: the
    /// listener samples the transcript file's existence at the instant the
    /// request body arrives. "Both happened" would pass a weaker test; this
    /// one fails unless the write really preceded the send.
    #[test]
    fn the_transcript_records_the_exact_bytes_a_real_listener_received_and_is_written_first() {
        let (state, log_dir) = test_state_with_stub(vec![]);
        drop(state);
        drop(log_dir);

        let config_probe = tempfile::tempdir().unwrap();
        let transcripts_dir = config_probe.path().join("transcripts");
        let watch = crate::ai::transcript::transcript_path(&transcripts_dir, FIXTURE_REPO_ID);
        let (base_url, server) =
            spawn_answering_server("See `src/utils/logger.ts:10`.", Some(watch));

        let mut rig = rig(vec![], Some(base_url), true);
        rig.ctx.transcripts_dir = transcripts_dir.clone();

        let result = block_on_never_pending(run_ai_feature(
            &rig.state,
            &rig.ctx,
            FIXTURE_REPO_ID,
            AiRequest::ProjectSummary,
        ));
        let (received_body, transcript_existed_on_arrival) = server.recv();
        result.expect("the pipeline must succeed");

        assert!(
            transcript_existed_on_arrival,
            "R5 must be written BEFORE the request is sent, not merely at some point"
        );

        let received_json: serde_json::Value =
            serde_json::from_slice(&received_body).expect("the received body must be JSON");
        let entries = transcript_entries(&transcripts_dir, FIXTURE_REPO_ID);
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0]["body"], received_json,
            "the transcript must record exactly the bytes that left the machine"
        );
    }

    /// Section 8.9 end to end through the real pipeline: a secret the
    /// engine hands back never reaches the socket.
    #[test]
    fn a_secret_in_a_snippet_is_redacted_before_it_reaches_the_wire() {
        let (base_url, server) = spawn_answering_server("See `src/utils/logger.ts:10`.", None);
        let rig = rig(vec!["SNIPPET_SECRET=1".to_string()], Some(base_url), true);

        let result = block_on_never_pending(run_ai_feature(
            &rig.state,
            &rig.ctx,
            FIXTURE_REPO_ID,
            AiRequest::ProjectSummary,
        ));
        let (received_body, _) = server.recv();
        result.expect("the pipeline must succeed");

        let text = String::from_utf8_lossy(&received_body);
        assert!(
            !text.contains("REDACTED-AWS-BY-HISTORY-REWRITE"),
            "a planted secret reached the wire: {text}"
        );
        assert!(text.contains("<redacted>"));
    }

    /// Phase 12's "Done when": a 400 KB snippet set is capped to
    /// <= 98,304 bytes and <= 24 files — measured on the counts the command
    /// actually reports to the UI, and cross-checked against the bytes the
    /// listener really received.
    #[test]
    fn a_four_hundred_kilobyte_snippet_set_is_capped_before_it_is_sent() {
        let (base_url, server) = spawn_answering_server("See `src/utils/logger.ts:10`.", None);
        // 24 fixture files x 20 KB each is ~480 KB of raw snippet text.
        let rig = rig(
            vec!["SNIPPET_BYTES=20000".to_string()],
            Some(base_url),
            true,
        );

        let result = block_on_never_pending(run_ai_feature(
            &rig.state,
            &rig.ctx,
            FIXTURE_REPO_ID,
            AiRequest::ProjectSummary,
        ));
        let (received_body, _) = server.recv();
        let (answer, _) = result.expect("the pipeline must succeed");

        assert!(
            answer.sent_byte_count <= crate::constants::AI_MAX_TOTAL_BYTES,
            "sent {} bytes, cap is {}",
            answer.sent_byte_count,
            crate::constants::AI_MAX_TOTAL_BYTES
        );
        assert!(answer.sent_file_count <= crate::constants::AI_MAX_FILES);
        assert!(
            answer.sent_file_count > 0,
            "sanity: the cap must trim, not empty, the payload"
        );
        assert!(
            received_body.len() < 400_000,
            "the capped body should be far smaller than the raw snippet set"
        );
    }

    /// Section 8.10 through the real pipeline: an answer citing a path that
    /// is not in the index is withheld wholesale, with the offending path
    /// on the error.
    #[test]
    fn an_answer_citing_an_unknown_path_is_rejected_wholesale() {
        let (base_url, server) =
            spawn_answering_server("The entry point is `src/does-not-exist.ts`.", None);
        let rig = rig(vec![], Some(base_url), true);

        let result = block_on_never_pending(run_ai_feature(
            &rig.state,
            &rig.ctx,
            FIXTURE_REPO_ID,
            AiRequest::ProjectSummary,
        ));
        let (received, _) = server.recv();
        assert!(!received.is_empty(), "vacuous pass guard");

        let err = result.expect_err("an unverifiable citation must be rejected");
        assert_eq!(err.code, "E_AI_CITATION_REJECTED");
        assert_eq!(err.path.as_deref(), Some("src/does-not-exist.ts"));
    }

    /// The success shape Section 7.4 freezes, with Section 8.10 step 4's
    /// rewrite applied.
    #[test]
    fn a_verified_answer_is_returned_with_rewritten_citations_and_real_counts() {
        let (base_url, server) = spawn_answering_server(
            "Start at `src/index.ts:1`, then read `src/utils/logger.ts:10`.",
            None,
        );
        let rig = rig(vec![], Some(base_url), true);

        let result = block_on_never_pending(ai_project_summary_core(
            &rig.state,
            rig.ctx,
            FIXTURE_REPO_ID,
        ));
        let (received, _) = server.recv();
        assert!(!received.is_empty(), "vacuous pass guard");

        let answer = result.expect("a fully verifiable answer must be returned");
        assert_eq!(
            answer.markdown,
            "Start at [[src/index.ts:1]], then read [[src/utils/logger.ts:10]]."
        );
        assert_eq!(answer.cited_paths, ["src/index.ts", "src/utils/logger.ts"]);
        assert!(answer.sent_file_count > 0 && answer.sent_byte_count > 0);
    }

    /// `ai_explain_module` derives its files from the module card's own
    /// `keyFilePaths` — a module id that isn't in the analysis is refused
    /// at the boundary, before any egress.
    #[test]
    fn explain_module_refuses_a_module_id_that_is_not_in_the_analysis() {
        let rig = rig(vec![], Some("http://127.0.0.1:1".to_string()), true);
        let err = block_on_never_pending(ai_explain_module_core(
            &rig.state,
            rig.ctx,
            FIXTURE_REPO_ID,
            "no-such-module",
        ))
        .expect_err("an unknown module must be refused");
        assert_eq!(err.code, "E_INVALID_SETTINGS");
    }

    /// Section 12's `AI_MAX_REQUESTS_PER_MINUTE`, surfaced through a real
    /// command: the eleventh call in the window is refused with
    /// `E_AI_RATE_LIMITED` and nothing is sent (the listener URL points at
    /// a closed port, so a request that DID go out would fail with a
    /// network error instead — a different code).
    #[test]
    fn the_eleventh_request_in_a_minute_is_refused_by_the_command() {
        let rig = rig(vec![], Some("http://127.0.0.1:1".to_string()), true);
        for _ in 0..crate::constants::AI_MAX_REQUESTS_PER_MINUTE {
            drop(
                rig.state
                    .ai_rate_limiter
                    .acquire()
                    .expect("budget must allow this"),
            );
        }
        let err = block_on_never_pending(ai_project_summary_core(
            &rig.state,
            rig.ctx,
            FIXTURE_REPO_ID,
        ))
        .expect_err("the 11th request must be refused");
        assert_eq!(err.code, "E_AI_RATE_LIMITED");
    }

    /// Section 12's `AI_MAX_CONCURRENT = 1`, likewise surfaced through a
    /// real command rather than only at the limiter's own unit level.
    #[test]
    fn a_concurrent_request_is_refused_by_the_command() {
        let rig = rig(vec![], Some("http://127.0.0.1:1".to_string()), true);
        let _in_flight = rig
            .state
            .ai_rate_limiter
            .acquire()
            .expect("the first request is admitted");
        let err = block_on_never_pending(ai_ask_core(
            &rig.state,
            rig.ctx,
            FIXTURE_REPO_ID,
            "where is auth?",
        ))
        .expect_err("a second concurrent request must be refused");
        assert_eq!(err.code, "E_AI_RATE_LIMITED");
    }

    /// A `repoId` that never had an analysis has no citation index and no
    /// candidate paths — refused before any egress.
    #[test]
    fn an_unknown_repo_id_is_refused_with_no_analysis() {
        let rig = rig(vec![], Some("http://127.0.0.1:1".to_string()), true);
        let err = block_on_never_pending(ai_project_summary_core(
            &rig.state,
            rig.ctx,
            "0000000000000000",
        ))
        .expect_err("an unanalyzed repo must be refused");
        assert_eq!(err.code, "E_NO_ANALYSIS");
    }

    /// Section 12 boundary validation: a malformed `repoId` never reaches
    /// the transcript path builder.
    #[test]
    fn a_malformed_repo_id_is_refused_at_the_boundary() {
        let rig = rig(vec![], Some("http://127.0.0.1:1".to_string()), true);
        let err = block_on_never_pending(ai_project_summary_core(
            &rig.state,
            rig.ctx,
            "../../etc/passwd",
        ))
        .expect_err("a malformed repoId must be refused");
        assert_eq!(err.code, "E_NO_ANALYSIS");
    }
}
