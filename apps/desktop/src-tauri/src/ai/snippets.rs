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

    let result: EngineSnippetsResult = serde_json::from_value(raw).map_err(|err| {
        AppError::new(
            AppErrorCode::EEngineCrashed,
            format!("Engine returned a response that does not match the frozen contract: {err}"),
        )
    })?;

    ensure_every_path_answered(paths.len(), result.snippets.len())?;
    Ok(result)
}

/// The invariant that was missing, and that let INV-3 reach the UI.
///
/// `engine.snippets` used to drop an escaping, missing, or unreadable path
/// silently. The engine now refuses the whole request instead — but the
/// PROXIMATE defect was that nothing on this side compared what was asked
/// for against what came back, so a shortfall flowed into `redact()` and
/// surfaced as `sent_file_count()`, an accurate count of survivors that
/// satisfied criterion 17 while concealing the refusal that produced it.
///
/// Fixing the engine closes today's instance. This closes the class: any
/// future silent drop anywhere upstream fails loudly at this boundary rather
/// than laundering into a smaller number. It is deliberately a check on
/// COUNT rather than on the specific paths — a count mismatch is
/// unambiguous, needs no ordering assumption, and cannot be satisfied by a
/// substitution.
fn ensure_every_path_answered(requested: usize, returned: usize) -> Result<(), AppError> {
    if requested == returned {
        return Ok(());
    }
    Err(AppError::new(
        AppErrorCode::EEngineCrashed,
        "Onboard asked the engine for a set of files and got a different number back, so nothing was sent.",
    )
    .with_detail(format!(
        "engine.snippets: requested {requested} path(s), received {returned}. A partial snippet set is refused rather than sent (Section 8.9 R3's precedent)."
    )))
}

#[cfg(test)]
mod length_invariant_tests {
    use super::ensure_every_path_answered;

    /// The exact INV-3 shape: 24 asked for, 23 returned because one was
    /// refused upstream. Before this check, that difference reached
    /// `sent_file_count()` and was displayed as an accurate total.
    #[test]
    fn a_short_result_is_an_error_not_data() {
        let err = ensure_every_path_answered(24, 23)
            .expect_err("a partial snippet set must be refused, not accepted");
        assert_eq!(err.code, "E_ENGINE_CRASHED");
        assert!(err.detail.unwrap_or_default().contains("requested 24"));
    }

    /// The other direction, so the check cannot decay into "at most as many
    /// as requested is fine" — more snippets than paths is equally a
    /// contract violation and equally must not be sent.
    #[test]
    fn an_over_long_result_is_also_refused() {
        assert!(ensure_every_path_answered(2, 3).is_err());
    }

    /// Non-vacuity: the check must PASS the case it is meant to allow, or
    /// it would be an assertion that simply always fails.
    #[test]
    fn an_exact_result_is_accepted() {
        assert!(ensure_every_path_answered(24, 24).is_ok());
        assert!(ensure_every_path_answered(0, 0).is_ok());
    }
}
