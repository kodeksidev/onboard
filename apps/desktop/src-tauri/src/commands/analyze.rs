//! `analyze_repo` (Section 7.4). Validates the chosen path, enforces the
//! "one analysis at a time" guard, forwards to the sidecar's
//! `engine.analyze`, and records the returned `repoId -> repoRoot` mapping
//! `read_repo_file` later needs for its confinement check.

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::Path;

use crate::constants::{PATH_ARG_MAX_BYTES, SIDECAR_ANALYZE_TIMEOUT};
use crate::contract::AnalysisEnvelope;
use crate::error::{AppError, AppErrorCode};
use crate::state::AppState;
use crate::util::paths::{display_name, is_system_root, strip_extended_prefix};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeRepoRequest {
    pub path: String,
    pub is_force_refresh: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeContext {
    pub app_data_dir: String,
    pub exclude_globs: Vec<String>,
}

/// Validates `request.path` per Section 12's `analyze_repo` capability
/// check: exists, is a directory, is not a system root. Returns the
/// canonicalized path on success.
fn validate_path(raw_path: &str) -> Result<std::path::PathBuf, AppError> {
    if raw_path.is_empty() || raw_path.len() > PATH_ARG_MAX_BYTES {
        return Err(AppError::path_not_found(raw_path));
    }

    let path = Path::new(raw_path);
    let name = display_name(path);

    let metadata =
        std::fs::metadata(path).map_err(|err| classify_metadata_error(err.kind(), &name))?;

    if !metadata.is_dir() {
        return Err(AppError::not_a_directory(&name));
    }
    if is_system_root(path) {
        return Err(AppError::system_root(raw_path));
    }

    std::fs::canonicalize(path).map_err(|_| AppError::permission_denied(&name))
}

/// Maps a `std::fs::metadata` failure kind to the Section 10 error it
/// represents. Kept standalone (rather than inlined in a `match` on the
/// `io::Error`) so it is unit-testable against a synthetic `io::ErrorKind`
/// without needing a real OS-denied directory (see `docs/DECISIONS.md`).
fn classify_metadata_error(kind: std::io::ErrorKind, display_name: &str) -> AppError {
    match kind {
        std::io::ErrorKind::NotFound => AppError::path_not_found(display_name),
        std::io::ErrorKind::PermissionDenied => AppError::permission_denied(display_name),
        _ => AppError::path_not_found(display_name),
    }
}

/// Core logic, independent of any Tauri type, so it is directly unit
/// testable against the stub sidecar.
pub fn analyze_repo_core(
    state: &AppState,
    request: AnalyzeRepoRequest,
    context: AnalyzeContext,
) -> Result<AnalysisEnvelope, AppError> {
    let canonical_root = validate_path(&request.path)?;

    let _guard = state.supervisor.begin_analysis()?;

    // `std::fs::canonicalize` always returns a `\\?\`-prefixed
    // extended-length path on Windows (needed for Rust's OWN filesystem
    // calls past the legacy 260-char limit — Section 10). That prefix is a
    // Windows/Rust-specific convention the sidecar (Bun/Node, Section 7.3)
    // has no reason to understand; strip it before it ever crosses the
    // process boundary so the engine receives an ordinary Windows path.
    let repo_path_for_engine = strip_extended_prefix(&canonical_root);

    let params = json!({
        "repoPath": repo_path_for_engine.to_string_lossy(),
        "appDataDir": context.app_data_dir,
        "excludeGlobs": context.exclude_globs,
        "isForceRefresh": request.is_force_refresh,
    });

    let raw_result = state
        .supervisor
        .call("engine.analyze", params, SIDECAR_ANALYZE_TIMEOUT)?;

    let envelope: AnalysisEnvelope = serde_json::from_value(raw_result).map_err(|err| {
        AppError::new(
            AppErrorCode::EEngineCrashed,
            format!("Engine returned a response that does not match the frozen contract: {err}"),
        )
    })?;

    state.record_analysis_session(
        envelope.result.repo.id.clone(),
        canonical_root,
        &envelope.result,
    );
    Ok(envelope)
}

#[cfg(test)]
mod tests {
    //! These tests only exercise `validate_path` and the analysis-in-flight
    //! guard, both of which fail (or short-circuit) before `analyze_repo_core`
    //! ever calls the sidecar — so a real spawnable program is never needed.
    //! The end-to-end "valid repo" path (which does call the stub sidecar)
    //! lives in `tests/analyze_repo.rs`: `CARGO_BIN_EXE_<name>` is only
    //! populated by Cargo for integration test targets, not `--lib` unit
    //! tests.
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

    fn default_context() -> AnalyzeContext {
        AnalyzeContext {
            app_data_dir: "C:/fake/appdata".to_string(),
            exclude_globs: vec![],
        }
    }

    #[test]
    fn classify_metadata_error_maps_permission_denied_to_the_literal_section_10_message() {
        let err = classify_metadata_error(std::io::ErrorKind::PermissionDenied, "acme-api");
        assert_eq!(err.code, "E_PERMISSION_DENIED");
        assert!(err.message.contains("acme-api"));
        assert!(err.message.contains("denied read access"));
    }

    #[test]
    fn classify_metadata_error_maps_not_found_to_path_not_found() {
        let err = classify_metadata_error(std::io::ErrorKind::NotFound, "acme-api");
        assert_eq!(err.code, "E_PATH_NOT_FOUND");
    }

    #[test]
    fn rejects_a_path_that_does_not_exist() {
        let state = test_state();
        let result = analyze_repo_core(
            &state,
            AnalyzeRepoRequest {
                path: "Z:/definitely/does/not/exist/anywhere".to_string(),
                is_force_refresh: false,
            },
            default_context(),
        );
        assert_eq!(result.unwrap_err().code, "E_PATH_NOT_FOUND");
    }

    #[test]
    fn rejects_a_file_path_as_not_a_directory() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("not-a-dir.txt");
        std::fs::write(&file_path, b"hi").unwrap();

        let state = test_state();
        let result = analyze_repo_core(
            &state,
            AnalyzeRepoRequest {
                path: file_path.to_string_lossy().to_string(),
                is_force_refresh: false,
            },
            default_context(),
        );
        assert_eq!(result.unwrap_err().code, "E_NOT_A_DIRECTORY");
    }

    #[test]
    fn rejects_a_system_root() {
        let state = test_state();
        #[cfg(windows)]
        let root = "C:\\";
        #[cfg(not(windows))]
        let root = "/";

        let result = analyze_repo_core(
            &state,
            AnalyzeRepoRequest {
                path: root.to_string(),
                is_force_refresh: false,
            },
            default_context(),
        );
        assert_eq!(result.unwrap_err().code, "E_NOT_A_DIRECTORY");
    }

    #[test]
    fn a_concurrent_analyze_is_rejected_while_one_is_already_in_flight() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state();
        // Simulate an in-flight analysis without a real hang (which would
        // otherwise block this test for the full 600s analyze timeout).
        let _guard = state.supervisor.begin_analysis().unwrap();

        let result = analyze_repo_core(
            &state,
            AnalyzeRepoRequest {
                path: dir.path().to_string_lossy().to_string(),
                is_force_refresh: false,
            },
            default_context(),
        );
        assert_eq!(result.unwrap_err().code, "E_ANALYSIS_IN_PROGRESS");
    }
}
