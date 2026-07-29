//! `search_repo` (Section 7.4). Validates the request against Section 12's
//! boundary checks, requires a completed analysis for `repoId`, and
//! forwards to the sidecar's `engine.search`.

use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::json;

use crate::constants::{
    SEARCH_LIMIT_MAX, SEARCH_LIMIT_MIN, SEARCH_QUERY_MAX_LEN, SIDECAR_RPC_TIMEOUT,
};
use crate::contract::SearchResponse;
use crate::error::{AppError, AppErrorCode};
use crate::state::AppState;

static REPO_ID_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new("^[0-9a-f]{16}$").expect("valid regex"));

/// `pub(crate)` since Phase 12 step 6: `commands::ai` validates `repoId`
/// at its own boundary too (Section 12), and it must be the SAME rule —
/// among other things the id becomes a transcript file name, so a value
/// that isn't 16 lowercase hex characters must never get that far.
pub(crate) fn validate_repo_id(repo_id: &str) -> Result<(), AppError> {
    if REPO_ID_PATTERN.is_match(repo_id) {
        Ok(())
    } else {
        Err(AppError::new(
            AppErrorCode::ENoAnalysis,
            "repoId must be a 16-character lowercase hex string.".to_string(),
        ))
    }
}

fn validate_query(query: &str) -> Result<(), AppError> {
    if query.is_empty() || query.chars().count() > SEARCH_QUERY_MAX_LEN {
        return Err(AppError::new(
            AppErrorCode::ENoAnalysis,
            format!("query must be 1-{SEARCH_QUERY_MAX_LEN} characters."),
        ));
    }
    Ok(())
}

fn validate_limit(limit: u32) -> Result<(), AppError> {
    if (SEARCH_LIMIT_MIN..=SEARCH_LIMIT_MAX).contains(&limit) {
        Ok(())
    } else {
        Err(AppError::new(
            AppErrorCode::ENoAnalysis,
            format!("limit must be between {SEARCH_LIMIT_MIN} and {SEARCH_LIMIT_MAX}."),
        ))
    }
}

pub fn search_repo_core(
    state: &AppState,
    repo_id: String,
    query: String,
    limit: u32,
) -> Result<SearchResponse, AppError> {
    validate_repo_id(&repo_id)?;
    validate_query(&query)?;
    validate_limit(limit)?;

    if !state.has_session(&repo_id) {
        return Err(AppError::no_analysis());
    }

    let params = json!({ "repoId": repo_id, "query": query, "limit": limit });
    let raw_result = state
        .supervisor
        .call("engine.search", params, SIDECAR_RPC_TIMEOUT)?;

    serde_json::from_value(raw_result).map_err(|err| {
        AppError::new(
            AppErrorCode::EEngineCrashed,
            format!("Engine returned a response that does not match the frozen contract: {err}"),
        )
    })
}

#[cfg(test)]
mod tests {
    //! `succeeds_once_a_session_is_recorded` (the one case that actually
    //! calls the sidecar) lives in `tests/search_repo.rs` instead — Cargo
    //! only populates `CARGO_BIN_EXE_<name>` for integration test targets.
    use super::*;
    use crate::sidecar::supervisor::{SidecarConfig, SidecarSupervisor};
    use crate::state::AppState;
    use std::collections::HashMap;
    use std::sync::Mutex;

    fn test_state() -> AppState {
        let config = SidecarConfig {
            program: Some(std::path::PathBuf::from("unused-in-validation-only-tests")),
            args: vec![],
            log_path: "C:/fake/onboard.log".to_string(),
            max_restarts: 3,
        };
        let temp_log = tempfile::tempdir().unwrap();
        AppState {
            supervisor: SidecarSupervisor::new(config),
            sessions: Mutex::new(HashMap::new()),
            ai_keys: crate::secrets::ai_key::AiKeyStore::new(),
            ai_rate_limiter: crate::ai::rate_limit::AiRateLimiter::new(),
            logger: crate::util::logging::RotatingLogger::open(
                &temp_log.path().join("onboard.log"),
            )
            .unwrap(),
        }
    }

    #[test]
    fn rejects_a_malformed_repo_id() {
        let state = test_state();
        let result = search_repo_core(&state, "not-16-hex".to_string(), "auth".to_string(), 50);
        assert!(result.is_err());
    }

    #[test]
    fn rejects_a_query_over_two_hundred_characters() {
        let state = test_state();
        let long_query = "a".repeat(201);
        let result = search_repo_core(&state, "0123456789abcdef".to_string(), long_query, 50);
        assert!(result.is_err());
    }

    #[test]
    fn rejects_a_limit_outside_one_to_two_hundred() {
        let state = test_state();
        let result = search_repo_core(
            &state,
            "0123456789abcdef".to_string(),
            "auth".to_string(),
            0,
        );
        assert!(result.is_err());
        let result = search_repo_core(
            &state,
            "0123456789abcdef".to_string(),
            "auth".to_string(),
            201,
        );
        assert!(result.is_err());
    }

    #[test]
    fn requires_a_completed_analysis_for_the_repo_id() {
        let state = test_state();
        let result = search_repo_core(
            &state,
            "0123456789abcdef".to_string(),
            "auth".to_string(),
            50,
        );
        assert_eq!(result.unwrap_err().code, "E_NO_ANALYSIS");
    }
}
