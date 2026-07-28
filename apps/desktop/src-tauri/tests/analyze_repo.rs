//! End-to-end `analyze_repo_core` test against the real stub sidecar
//! process. Lives under `tests/` (not `src/commands/analyze.rs`'s unit
//! test module) because `CARGO_BIN_EXE_<name>` is only populated for
//! integration test targets.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use onboard_lib::commands::analyze::{analyze_repo_core, AnalyzeContext, AnalyzeRepoRequest};
use onboard_lib::secrets::ai_key::AiKeyStore;
use onboard_lib::sidecar::supervisor::{SidecarConfig, SidecarSupervisor};
use onboard_lib::state::AppState;
use onboard_lib::util::logging::RotatingLogger;

fn test_state() -> AppState {
    let config = SidecarConfig {
        program: PathBuf::from(env!("CARGO_BIN_EXE_onboard_engine_stub")),
        args: vec![],
        log_path: "C:/fake/onboard.log".to_string(),
        max_restarts: 3,
    };
    let temp_log = tempfile::tempdir().unwrap();
    AppState {
        supervisor: SidecarSupervisor::new(config),
        sessions: Mutex::new(HashMap::new()),
        ai_keys: AiKeyStore::new(),
        ai_rate_limiter: onboard_lib::ai::rate_limit::AiRateLimiter::new(),
        logger: RotatingLogger::open(&temp_log.path().join("onboard.log")).unwrap(),
    }
}

#[test]
fn a_valid_repo_returns_the_fixture_envelope_and_records_the_session() {
    let dir = tempfile::tempdir().unwrap();
    let state = test_state();

    let result = analyze_repo_core(
        &state,
        AnalyzeRepoRequest {
            path: dir.path().to_string_lossy().to_string(),
            is_force_refresh: false,
        },
        AnalyzeContext {
            app_data_dir: "C:/fake/appdata".to_string(),
            exclude_globs: vec![],
        },
    );

    let envelope = result.expect("stub sidecar should succeed");
    assert_eq!(
        envelope.result.schema_version,
        onboard_lib::contract::SCHEMA_VERSION
    );
    assert!(state.has_session(&envelope.result.repo.id));
}
