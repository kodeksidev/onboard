//! Integration tests for `sidecar::supervisor`, driven against the real
//! compiled stub sidecar binary (`onboard_engine_stub`, Phase 6's stand-in
//! for the Phase 5 engine). These live under `tests/` — not inside
//! `src/sidecar/supervisor.rs`'s unit test module — because
//! `CARGO_BIN_EXE_<name>` is only populated by Cargo for integration test
//! and benchmark targets, never for `--lib` unit tests.

use std::path::PathBuf;
use std::time::Duration;

use onboard_lib::constants::SIDECAR_MAX_RESTARTS;
use onboard_lib::sidecar::supervisor::{SidecarConfig, SidecarSupervisor};
use serde_json::json;

fn stub_program() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_onboard_engine_stub"))
}

fn test_config(extra_env_args: &[(&str, &str)]) -> SidecarConfig {
    // The stub reads behavior toggles from argv (`key=value` pairs) so each
    // test gets an isolated, deterministic process rather than mutating
    // shared process environment variables.
    let args = extra_env_args
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect();
    SidecarConfig {
        program: stub_program(),
        args,
        log_path: "C:/fake/onboard.log".to_string(),
        max_restarts: SIDECAR_MAX_RESTARTS,
    }
}

const ANALYZE_PARAMS: fn() -> serde_json::Value =
    || json!({"repoPath": "x", "appDataDir": "y", "excludeGlobs": [], "isForceRefresh": false});

#[test]
fn a_healthy_handshake_starts_the_sidecar_successfully() {
    let supervisor = SidecarSupervisor::new(test_config(&[]));
    let result = supervisor.call("engine.shutdown", json!({}), Duration::from_secs(5));
    assert!(result.is_ok(), "{result:?}");
}

#[test]
fn a_crash_produces_engine_crashed_with_the_exact_section_10_copy_and_restarts_once() {
    let supervisor = SidecarSupervisor::new(test_config(&[("CRASH_ON", "engine.analyze")]));

    let result = supervisor.call("engine.analyze", ANALYZE_PARAMS(), Duration::from_secs(5));

    let err = result.expect_err("expected the crash to surface as an error");
    assert_eq!(err.code, "E_ENGINE_CRASHED");
    // The exact Section 10 copy (the long, parameterized description —
    // AppError has one text field, and `message` carries it; see
    // `error.rs`'s doc comment on why the short static title never lives
    // in AppError at all).
    assert_eq!(
        err.message,
        "The analysis engine exited before finishing. The log is at C:/fake/onboard.log. Retrying usually works — the cache keeps completed files."
    );
    assert_eq!(supervisor.restart_count(), 1);

    // Restart budget was actually spent: the next call spawns a fresh
    // process and succeeds.
    let follow_up = supervisor.call("engine.shutdown", json!({}), Duration::from_secs(5));
    assert!(follow_up.is_ok(), "{follow_up:?}");
}

#[test]
fn a_malformed_frame_is_never_partially_trusted_and_restarts_the_sidecar() {
    let supervisor = SidecarSupervisor::new(test_config(&[("MALFORMED_ON", "engine.analyze")]));

    let result = supervisor.call("engine.analyze", ANALYZE_PARAMS(), Duration::from_secs(5));

    assert_eq!(result.unwrap_err().code, "E_ENGINE_CRASHED");
    assert_eq!(supervisor.restart_count(), 1);
}

#[test]
fn a_hang_times_out_and_the_process_is_killed() {
    let supervisor = SidecarSupervisor::new(test_config(&[("HANG_ON", "engine.analyze")]));

    let result = supervisor.call(
        "engine.analyze",
        ANALYZE_PARAMS(),
        Duration::from_millis(200),
    );

    assert_eq!(result.unwrap_err().code, "E_ENGINE_TIMEOUT");
}

#[test]
fn restart_budget_is_never_exceeded() {
    let supervisor = SidecarSupervisor::new(test_config(&[("CRASH_ON", "engine.analyze")]));

    for _ in 0..(SIDECAR_MAX_RESTARTS + 2) {
        let _ = supervisor.call("engine.analyze", ANALYZE_PARAMS(), Duration::from_secs(5));
    }

    assert!(supervisor.restart_count() <= SIDECAR_MAX_RESTARTS);
}

#[test]
fn a_second_concurrent_analysis_is_rejected() {
    let supervisor = SidecarSupervisor::new(test_config(&[]));
    let _guard = supervisor.begin_analysis().unwrap();

    let second = supervisor.begin_analysis();
    match second {
        Err(err) => assert_eq!(err.code, "E_ANALYSIS_IN_PROGRESS"),
        Ok(_) => panic!("expected a second concurrent analysis to be rejected"),
    }
}

#[test]
fn releasing_the_guard_allows_a_new_analysis() {
    let supervisor = SidecarSupervisor::new(test_config(&[]));
    {
        let _guard = supervisor.begin_analysis().unwrap();
    }
    assert!(supervisor.begin_analysis().is_ok());
}

#[test]
fn a_version_mismatch_is_reported_distinctly() {
    let supervisor = SidecarSupervisor::new(test_config(&[("VERSION_MISMATCH", "1")]));
    let result = supervisor.call("engine.shutdown", json!({}), Duration::from_secs(5));
    assert_eq!(result.unwrap_err().code, "E_ENGINE_VERSION_MISMATCH");
}

#[test]
fn the_stub_binary_used_by_these_tests_exists() {
    assert!(stub_program().exists());
}
