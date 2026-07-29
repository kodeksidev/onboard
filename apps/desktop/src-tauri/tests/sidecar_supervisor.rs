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
        program: Some(stub_program()),
        args,
        log_path: "C:/fake/onboard.log".to_string(),
        max_restarts: SIDECAR_MAX_RESTARTS,
    }
}

const ANALYZE_PARAMS: fn() -> serde_json::Value =
    || json!({"repoPath": "x", "appDataDir": "y", "excludeGlobs": [], "isForceRefresh": false});

/// The v0.1.0 Windows `.msi` shipped an app that reported
/// `E_ENGINE_CRASHED` with the body "Failed to start the analysis engine
/// process: The system cannot find the path specified. (os error 3)" — for
/// an engine it had never spawned. Two defects in one string: the wrong
/// code, and a raw OS error in the copy a user reads.
///
/// Startup resolution now yields `None` instead of a constructed path, so
/// this asserts what the user actually gets in that state.
#[test]
fn an_unresolved_engine_reports_not_started_and_keeps_os_strings_out_of_the_message() {
    let supervisor = SidecarSupervisor::new(SidecarConfig {
        program: None,
        args: vec![],
        log_path: "C:/fake/onboard.log".to_string(),
        max_restarts: SIDECAR_MAX_RESTARTS,
    });

    let err = supervisor
        .call("engine.analyze", ANALYZE_PARAMS(), Duration::from_secs(5))
        .expect_err("an unresolved engine cannot analyze anything");

    assert_eq!(err.code, "E_ENGINE_NOT_STARTED");
    assert!(
        !err.message.to_lowercase().contains("os error"),
        "Section 12: the OS string belongs in `detail`, not `message` — got {:?}",
        err.message
    );
    // The copy names the log, so the user has somewhere to look.
    assert!(
        err.message.contains("C:/fake/onboard.log"),
        "expected the log path in the message, got {:?}",
        err.message
    );
}

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

/// CROSS-DOMAIN. The engine (`packages/engine`) does not survive two
/// overlapping `analyze()` calls: identical content analysed concurrently
/// disagrees on `edges`, `symbolCount`, `pageRank` and `diagnostics` (107
/// differing leaves, against 3 sequentially — see `docs/DECISIONS.md`).
///
/// This guard is what keeps that unreachable from the shell, and it is
/// DELIBERATELY STRICTER than the build spec's Phase 6 wording, "one analysis
/// at a time per repo". Implementing that wording faithfully — keying the flag
/// by `repoId` so two different repositories may run at once — would corrupt
/// both results.
///
/// The no-repo-argument signature is therefore load-bearing, not incidental.
/// Binding the method to a function pointer of the exact expected type means
/// adding a repo parameter fails to COMPILE here, rather than silently
/// re-opening the defect. `packages/engine` now refuses overlap on its own side
/// too (`test/analyze/no-overlap.test.ts`); this is the other half.
#[test]
fn the_analysis_guard_is_process_wide_not_per_repo() {
    let begin: for<'a> fn(
        &'a SidecarSupervisor,
    ) -> Result<
        onboard_lib::sidecar::supervisor::AnalysisGuard<'a>,
        onboard_lib::error::AppError,
    > = SidecarSupervisor::begin_analysis;

    let supervisor = SidecarSupervisor::new(test_config(&[]));
    let _held = begin(&supervisor).expect("first analysis should acquire the guard");

    // No repository identity is involved anywhere in this rejection.
    let second = begin(&supervisor);
    match second {
        Err(err) => assert_eq!(err.code, "E_ANALYSIS_IN_PROGRESS"),
        Ok(_) => panic!("a second analysis must be rejected, whatever repo it targets"),
    };
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
