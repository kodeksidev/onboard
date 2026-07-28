//! Section 8.9 / Section 12 — the redaction boundary (`redact`, plus its
//! `caps`/`patterns` helpers) and Section 8.10's inbound counterpart
//! (`verify_citations`). Redaction guards what leaves the machine; citation
//! verification guards what the model's answer is allowed to claim about
//! what is on it.

pub mod caps;
pub mod fake_secrets;
pub mod patterns;
pub mod redact;
pub mod verify_citations;
