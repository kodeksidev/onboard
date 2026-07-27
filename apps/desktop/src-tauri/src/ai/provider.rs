//! `ai/provider.rs` — Section 9 Phase 12: "The `AiProvider` trait is
//! `async fn complete(&self, req: CompletionRequest) -> Result<CompletionResponse,
//! AppError>` and `async fn test(&self) -> Result<TestResult, AppError>` —
//! nothing provider-specific leaks past it." Anthropic
//! ([`crate::ai::anthropic`]) is the first (and, Phase 12 step 3A, only)
//! implementation; `ollama` and `openai-compatible` slot in behind this
//! same trait unchanged, after the owner reviews this leg.
//!
//! ## Naming collision, deliberately, per the frozen contract
//!
//! Section 9 names this trait `AiProvider`. `commands::settings::AiProvider`
//! is the pre-existing (Phase 6) settings enum naming WHICH provider is
//! configured (`Anthropic` / `Ollama`). They live in different modules and
//! never collide at compile time — Rust namespaces per-module — but any
//! file that needs both (every adapter does) must not `use` both
//! unqualified. Convention followed throughout this crate: the trait is
//! imported unqualified (`use crate::ai::provider::AiProvider;`); the
//! settings enum is always referred to by its full path
//! (`crate::commands::settings::AiProvider::Anthropic`) so the two are
//! visually distinguishable at every use site.
//!
//! ## Why `async fn`, given `ai::http::send` is a blocking HTTP call
//!
//! This trait shape is frozen by Section 9 and implemented as written
//! (native async-fn-in-trait, stable since Rust 1.75 — no `async-trait`
//! dependency needed). The Anthropic implementation's body performs a
//! genuinely *blocking* call inside that `async fn` (no real `.await`
//! suspension point exists in `ai::http::send`), which is not idiomatic —
//! see `docs/DECISIONS.md`'s Phase 12 step 3A entry for the tradeoff this
//! makes, why it doesn't block anything today, and a recommendation for
//! what should change if a future phase needs concurrent in-flight
//! requests (Section 9's own `AI_MAX_CONCURRENT = 1` suggests it may
//! never need to).

use crate::error::AppError;
use crate::privacy::redact::RedactedPayload;

/// The task to complete: already-redacted content plus plain task
/// instructions. Neither field can carry raw, unredacted repo content —
/// `instructions` is a static task description (never repo content; the
/// actual prompt templates are `prompt.rs`, a later Phase 12 sub-step,
/// deliberately not built here), and `payload` is a `RedactedPayload`,
/// which by construction has already been through Section 8.9 R1-R4
/// redaction and has no public constructor of its own.
#[derive(Debug)]
pub struct CompletionRequest {
    pub instructions: String,
    pub payload: RedactedPayload,
}

/// What comes back from a real completion — provider-specific response
/// shapes are parsed away by the adapter; only plain text reaches here.
#[derive(Debug)]
pub struct CompletionResponse {
    pub text: String,
}

/// The outcome of `test()` — "does this provider/model/key combination
/// actually work right now." Provisional shape (this sub-step is adapters
/// only; the `test_ai_key` IPC command and `TestKeyButton.tsx` that will
/// consume this are out of scope here — see `docs/DECISIONS.md`).
#[derive(Debug)]
pub struct TestResult {
    pub is_ok: bool,
}

/// Section 9 Phase 12's provider interface. Every implementation must
/// route every real request through `ai::http::send`'s full WHAT/WHETHER/
/// WHERE triad (`ai::http`'s doc comment) — provider, model, and key come
/// from stored settings and the OS keychain, resolved inside the adapter
/// itself, never a caller argument to `complete`/`test`.
///
/// Written as `-> impl Future<..> + Send` rather than bare `async fn`
/// (which `cargo clippy --all-targets -- -D warnings` rejects outright —
/// `async_fn_in_trait`'s auto-trait-bounds warning): same frozen Section 9
/// signature and call-site shape, but the futures this trait's methods
/// return are usable from Tauri's own (`tokio`-based) async command
/// runtime, which generally requires `Send` futures — a real requirement
/// for how this trait will actually be invoked once `commands/ai.rs`
/// lands, not just lint-appeasement.
pub trait AiProvider {
    fn complete(
        &self,
        req: CompletionRequest,
    ) -> impl std::future::Future<Output = Result<CompletionResponse, AppError>> + Send;

    fn test(&self) -> impl std::future::Future<Output = Result<TestResult, AppError>> + Send;
}
