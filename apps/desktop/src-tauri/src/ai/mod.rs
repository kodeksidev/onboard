//! Phase 12's AI layer. Step 2 owns exactly two things: `http` (the sole
//! outbound module — Section 5's egress chokepoint) and `permit` (the
//! capability token that gates it). `provider`/`anthropic`/`ollama`/
//! `prompt`/`transcript` are step 3, after review — deliberately absent.

pub mod http;
pub mod permit;
