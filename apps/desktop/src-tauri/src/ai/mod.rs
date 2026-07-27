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
//! `prompt`, `transcript` are later Phase 12 sub-steps, after the owner
//! reviews this leg — deliberately absent. So is any code that calls these
//! adapters for the three AI features (summary, module explanations,
//! Q&A) — this phase is adapters only.

pub mod anthropic;
pub mod endpoint;
pub mod http;
pub mod ollama;
pub mod openai_compatible;
pub mod permit;
pub mod provider;
