//! Phase 12's AI layer. Step 2 owns three things, the full compile-time
//! triad: `http` (the sole outbound module — Section 5's egress
//! chokepoint), `permit` (WHETHER — the capability token that gates it),
//! and `endpoint` (WHERE — the resolved-from-settings target URL).
//! `provider`/`anthropic`/`ollama`/`prompt`/`transcript` are step 3, after
//! review — deliberately absent.

pub mod endpoint;
pub mod http;
pub mod permit;
