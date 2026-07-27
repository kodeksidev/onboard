//! Phase 12's AI layer.
//!
//! - `http` — the sole outbound module (Section 5's egress chokepoint).
//! - `permit` — WHETHER: the capability token that gates `http::send`.
//! - `endpoint` — WHERE: the resolved-from-settings target URL.
//! - `provider` — Section 9's `AiProvider` trait every adapter implements.
//! - `anthropic` — step 3A: the Anthropic Messages API adapter, the first
//!   real implementation.
//!
//! `ollama`/`openai-compatible` (step 3B/3C), `prompt`, `transcript` are
//! later Phase 12 sub-steps, after the owner reviews this leg —
//! deliberately absent. So is any code that calls these adapters for the
//! three AI features (summary, module explanations, Q&A) — this phase is
//! adapters only.

pub mod anthropic;
pub mod endpoint;
pub mod http;
pub mod permit;
pub mod provider;
