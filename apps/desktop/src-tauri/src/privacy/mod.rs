//! Section 8.9 / Section 12 — the redaction boundary. Phase 12 step 1 owns
//! `redact` (+ its `caps`/`patterns` helpers) only; `verify_citations`
//! (Section 8.10) is a later step and deliberately not present yet.

pub mod caps;
pub mod patterns;
pub mod redact;
