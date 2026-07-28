//! `ai/snippets.rs` — the Rust caller for Section 7.3's `engine.snippets`:
//! **"The only source of text the AI path may use."**
//!
//! That sentence is a constraint on this whole crate, not just a note on
//! one RPC row, so it is worth stating what makes it true here:
//!
//! - This is the only function the AI path calls to obtain file text.
//!   `commands::read_file` (`engine.readFile`) serves the viewer and is
//!   never called from `ai::` or from `commands::ai`; nothing under `ai::`
//!   performs filesystem reads at all (no `std::fs::read*` appears in any
//!   `ai/` module).
//! - Its result type is [`EngineSnippetsResult`], which is *also* the only
//!   input type `privacy::redact::redact` accepts — see that module's doc
//!   comment. So the sole producer of text feeds directly into the sole
//!   producer of `RedactedPayload`, which is in turn the only thing a
//!   `PromptSpec` (and therefore `ai::http::send`) can be built from. The
//!   chain snippets → redact → prompt → send has no side entrances.
//! - The per-file caps are passed to the engine as well as enforced again
//!   after redaction (Section 8.9 R4). Asking the engine for less is a
//!   courtesy, not the guarantee; `redact` re-applies both caps to whatever
//!   actually comes back.

use serde_json::json;

use crate::constants::{AI_MAX_BYTES_PER_FILE, AI_MAX_LINES_PER_FILE, SIDECAR_RPC_TIMEOUT};
use crate::contract::EngineSnippetsResult;
use crate::error::{AppError, AppErrorCode};
use crate::sidecar::supervisor::SidecarSupervisor;

/// Section 7.3: `engine.snippets` — `{ repoId, paths, maxLinesPerFile,
/// maxBytesPerFile }` → `{ snippets: [{ path, startLine, endLine, content }] }`.
/// `paths` must already be ranked (Section 8.9 R4 keeps the head and drops
/// the tail), which is why every caller derives it from a ranked source:
/// `importantFilePaths`, a module card's `keyFilePaths`, or `engine.search`
/// hits in score order.
pub fn fetch(
    supervisor: &SidecarSupervisor,
    repo_id: &str,
    paths: &[String],
) -> Result<EngineSnippetsResult, AppError> {
    let params = json!({
        "repoId": repo_id,
        "paths": paths,
        "maxLinesPerFile": AI_MAX_LINES_PER_FILE,
        "maxBytesPerFile": AI_MAX_BYTES_PER_FILE,
    });
    let raw = supervisor.call("engine.snippets", params, SIDECAR_RPC_TIMEOUT)?;

    serde_json::from_value(raw).map_err(|err| {
        AppError::new(
            AppErrorCode::EEngineCrashed,
            format!("Engine returned a response that does not match the frozen contract: {err}"),
        )
    })
}
