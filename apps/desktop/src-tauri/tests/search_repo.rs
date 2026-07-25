//! End-to-end `search_repo_core` test against the real stub sidecar
//! process (see `tests/analyze_repo.rs` for why this lives under `tests/`).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use onboard_lib::commands::search::search_repo_core;
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
        logger: RotatingLogger::open(&temp_log.path().join("onboard.log")).unwrap(),
    }
}

#[test]
fn succeeds_once_a_session_is_recorded() {
    let state = test_state();
    state.record_session("0123456789abcdef".to_string(), std::env::temp_dir());

    let result = search_repo_core(
        &state,
        "0123456789abcdef".to_string(),
        "auth".to_string(),
        50,
    );
    assert!(result.is_ok(), "{result:?}");
}
