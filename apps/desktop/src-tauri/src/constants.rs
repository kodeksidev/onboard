//! `UPPER_SNAKE_CASE` constants owned by the Rust shell (mirrors the
//! engine's `packages/engine/src/constants.ts` convention — Section 9,
//! Phase 6). No literal named here may be inlined elsewhere in this crate.

use std::time::Duration;

/// Sidecar restarts allowed per app session (Section 9, Phase 6).
pub const SIDECAR_MAX_RESTARTS: u32 = 3;

/// `engine.analyze` RPC timeout (Section 9, Phase 6 / Section 10).
pub const SIDECAR_ANALYZE_TIMEOUT_SECS: u64 = 600;

/// Every other sidecar RPC's timeout (Section 9, Phase 6 / Section 10).
pub const SIDECAR_RPC_TIMEOUT_SECS: u64 = 30;

pub const SIDECAR_ANALYZE_TIMEOUT: Duration = Duration::from_secs(SIDECAR_ANALYZE_TIMEOUT_SECS);
pub const SIDECAR_RPC_TIMEOUT: Duration = Duration::from_secs(SIDECAR_RPC_TIMEOUT_SECS);

/// `packages/contract`'s frozen `SCHEMA_VERSION` (Section 7.1). Checked
/// against `engine.version`'s `contractSchemaVersion` at spawn; a mismatch
/// aborts with `E_ENGINE_VERSION_MISMATCH` (Section 7.3).
pub const CONTRACT_SCHEMA_VERSION: i64 = 1;

/// `repoId` wire format (Section 6.1: `sha256(...).slice(0, 16)`, lowercase
/// hex) — validated at every command boundary (Section 12).
pub const REPO_ID_LEN: usize = 16;

/// `search_repo`'s `query` field cap (Section 7.2 / Section 12).
pub const SEARCH_QUERY_MAX_LEN: usize = 200;

/// `search_repo`'s `limit` field bounds (Section 7.2 / Section 12).
pub const SEARCH_LIMIT_MIN: u32 = 1;
pub const SEARCH_LIMIT_MAX: u32 = 200;

/// Generic `path` argument byte cap (Section 12).
pub const PATH_ARG_MAX_BYTES: usize = 4096;

/// API key length bounds accepted by `store_ai_key` (Section 12).
pub const AI_KEY_MIN_LEN: usize = 8;
pub const AI_KEY_MAX_LEN: usize = 512;

/// Section 8.9 R4 caps, enforced after redaction, before anything is sent.
pub const AI_MAX_LINES_PER_FILE: usize = 200;
pub const AI_MAX_BYTES_PER_FILE: usize = 8192;
pub const AI_MAX_FILES: usize = 24;
pub const AI_MAX_TOTAL_BYTES: usize = 98_304;

/// Section 8.9 R2 rule thresholds that aren't regex literals.
pub const HIGH_ENTROPY_MIN_LEN: usize = 24;
pub const HIGH_ENTROPY_MIN_CHAR_CLASSES: u32 = 3;
pub const HIGH_ENTROPY_MIN_BITS_PER_CHAR: f64 = 4.0;
pub const ASSIGNMENT_HEURISTIC_MIN_VALUE_LEN: usize = 8;
