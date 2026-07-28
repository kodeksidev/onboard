//! Phase 12's AI layer.
//!
//! - `http` — the sole outbound module (Section 5's egress chokepoint).
//! - `permit` — WHETHER: the capability token that gates `http::send`.
//! - `endpoint` — WHERE: the resolved-from-settings target URL.
//! - `provider` — Section 9's `AiProvider` trait every adapter implements.
//! - `anthropic` / `ollama` / `openai_compatible` — the three v1 adapters
//!   (§3 non-goal 2 caps v1 at exactly these three), each routing every
//!   real request through the same `http::send` triad. No adapter has its
//!   own HTTP path, its own endpoint argument, or any other route to the
//!   wire.
//!
//! Phase 12 step 6 added the rest of the AI path:
//!
//! - `snippets` — the Rust caller for `engine.snippets`, Section 7.3's
//!   "only source of text the AI path may use".
//! - `prompt` — WHAT, part 2: `PromptSpec`, buildable only from a typed
//!   feature enum plus a `RedactedPayload`, so `http::send` still has no
//!   free-form body parameter of any kind.
//! - `transcript` — Section 8.9 R5: the exact post-redaction, post-cap
//!   body, written locally before it is sent.
//! - `rate_limit` — Section 12's `AI_MAX_REQUESTS_PER_MINUTE = 10` and
//!   `AI_MAX_CONCURRENT = 1`.
//!
//! The one ordered pipeline that uses all of them lives in
//! `commands::ai::run_ai_feature` — see that module's doc comment.

pub mod anthropic;
pub mod endpoint;
pub mod http;
pub mod ollama;
pub mod openai_compatible;
pub mod permit;
pub mod pipeline;
pub mod prompt;
pub mod provider;
pub mod rate_limit;
pub mod snippets;
pub mod transcript;
