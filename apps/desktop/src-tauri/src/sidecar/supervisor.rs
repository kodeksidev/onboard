//! Sidecar lifecycle: spawn, `engine.version` handshake, restart-on-crash
//! (`SIDECAR_MAX_RESTARTS`), timeout enforcement, and the "one analysis at a
//! time" guard behind `E_ANALYSIS_IN_PROGRESS` (Section 9, Phase 6).
//!
//! There is exactly one sidecar process and one stdio pipe, so every RPC
//! call is already serialized at the transport level; the analysis guard
//! here exists to turn a *second concurrent `analyze_repo` invocation* into
//! a clean, immediate `E_ANALYSIS_IN_PROGRESS` instead of a call that would
//! otherwise queue silently behind the first (see `docs/DECISIONS.md`).

use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use serde_json::{json, Value};

use crate::constants::{CONTRACT_SCHEMA_VERSION, SIDECAR_MAX_RESTARTS};
use crate::error::{AppError, AppErrorCode};
use crate::sidecar::rpc::{RpcConnection, RpcError};
use crate::sidecar::spawn::{spawn_sidecar, SpawnedChild};
use crate::util::logging::RotatingLogger;

/// What `engine.version` actually told us, kept around after the handshake
/// so `get_engine_info` (Section 7.4) can answer without a live process and
/// so it survives a restart. NOT itself part of the version check —
/// `ensure_started` compares `contractSchemaVersion` only (see its own doc
/// comment for why that is a known, named gap, not an oversight repeated
/// here). This struct exists so the two fields the check does NOT look at
/// are recorded somewhere, rather than read off the wire and discarded —
/// see docs/DECISIONS.md ("engine.version was answered and discarded").
#[derive(Debug, Clone)]
pub struct EngineHandshakeInfo {
    pub engine_version: String,
    pub contract_schema_version: i64,
    pub grammar_fingerprint: String,
}

/// Checks `engine.version`'s ONLY checked field, logs all three, and
/// returns the other two regardless of anything this function does not
/// check. Split out of `ensure_started` to keep it under this crate's
/// 50-line-per-function limit — same reason `tauri-ipc.ts`'s
/// `createTauriIpc` was split.
fn record_handshake(result: &Value, log_path: &str) -> Result<EngineHandshakeInfo, AppError> {
    let contract_version = result.get("contractSchemaVersion").and_then(Value::as_i64);
    if contract_version != Some(CONTRACT_SCHEMA_VERSION) {
        return Err(AppError::new(
            AppErrorCode::EEngineVersionMismatch,
            format!(
                "Engine reported contract schema version {contract_version:?}, expected {CONTRACT_SCHEMA_VERSION}."
            ),
        ));
    }
    // `engineVersion`/`grammarFingerprint` are read but NOT compared against
    // anything here — see `CONTRACT_SCHEMA_VERSION`'s and
    // `EngineHandshakeInfo`'s doc comments. Recorded regardless, so at least
    // the information reaches the log and `get_engine_info`, even though
    // nothing yet refuses to start on a mismatch in either.
    let engine_version = result
        .get("engineVersion")
        .and_then(Value::as_str)
        .unwrap_or("(missing)")
        .to_string();
    let grammar_fingerprint = result
        .get("grammarFingerprint")
        .and_then(Value::as_str)
        .unwrap_or("(missing)")
        .to_string();
    if let Ok(logger) = RotatingLogger::open(std::path::Path::new(log_path)) {
        let _ = logger.log_line(&format!(
            "engine handshake: engineVersion={engine_version} contractSchemaVersion={} grammarFingerprint={grammar_fingerprint}",
            contract_version.unwrap_or(-1)
        ));
    }
    Ok(EngineHandshakeInfo {
        engine_version,
        contract_schema_version: contract_version.unwrap_or(-1),
        grammar_fingerprint,
    })
}

pub struct SidecarConfig {
    /// `None` when the engine binary could not be located at startup —
    /// a missing or damaged installation. Modelled as an absent value
    /// rather than a constructed placeholder path so the failure surfaces
    /// as `E_ENGINE_NOT_STARTED` at the first call, instead of as whatever
    /// the OS says about a path that was never meant to exist.
    pub program: Option<PathBuf>,
    pub args: Vec<String>,
    /// Path shown in `E_ENGINE_CRASHED`'s detail copy (Section 10).
    pub log_path: String,
    pub max_restarts: u32,
}

struct Live {
    child: SpawnedChild,
    connection: RpcConnection,
}

struct State {
    live: Option<Live>,
    restart_count: u32,
    analysis_in_progress: bool,
}

pub struct SidecarSupervisor {
    config: SidecarConfig,
    state: Mutex<State>,
    /// `engine.progress` notifications, forwarded here for the caller
    /// (`lib.rs`) to fan out as `onboard://analysis-progress` events.
    pub progress_rx: Mutex<Receiver<(String, Value)>>,
    progress_tx: Sender<(String, Value)>,
    /// Set once, on the first successful handshake; kept across restarts and
    /// never cleared, so `get_engine_info` can still answer after a crash.
    last_handshake: Mutex<Option<EngineHandshakeInfo>>,
}

impl SidecarSupervisor {
    pub fn new(config: SidecarConfig) -> Self {
        let (progress_tx, progress_rx) = mpsc::channel();
        SidecarSupervisor {
            config,
            state: Mutex::new(State {
                live: None,
                restart_count: 0,
                analysis_in_progress: false,
            }),
            progress_rx: Mutex::new(progress_rx),
            progress_tx,
            last_handshake: Mutex::new(None),
        }
    }

    pub fn restart_count(&self) -> u32 {
        self.state.lock().expect("state poisoned").restart_count
    }

    /// `None` until the sidecar has spawned and answered `engine.version`
    /// at least once — e.g. before the first `analyze_repo` call, or if the
    /// engine binary was never found at all.
    pub fn last_handshake(&self) -> Option<EngineHandshakeInfo> {
        self.last_handshake
            .lock()
            .expect("last_handshake poisoned")
            .clone()
    }

    /// Acquires the "one analysis at a time" guard. Drop the returned guard
    /// to release it (it releases automatically when the call finishes,
    /// succeeds, or errors).
    pub fn begin_analysis(&self) -> Result<AnalysisGuard<'_>, AppError> {
        let mut state = self.state.lock().expect("state poisoned");
        if state.analysis_in_progress {
            return Err(AppError::analysis_in_progress());
        }
        state.analysis_in_progress = true;
        Ok(AnalysisGuard { supervisor: self })
    }

    fn end_analysis(&self) {
        self.state
            .lock()
            .expect("state poisoned")
            .analysis_in_progress = false;
    }

    /// Spawns the process and performs the `engine.version` handshake if no
    /// live connection exists yet.
    fn ensure_started(&self, state: &mut MutexGuard<'_, State>) -> Result<(), AppError> {
        if state.live.is_some() {
            return Ok(());
        }
        let program = self
            .config
            .program
            .as_ref()
            .ok_or_else(|| AppError::engine_not_started(&self.config.log_path))?;
        let mut spawned = spawn_sidecar(program, &self.config.args, &self.config.log_path)?;
        let stdin = spawned.child.stdin.take().expect("stdin was piped");
        let stdout = spawned.child.stdout.take().expect("stdout was piped");
        let connection =
            RpcConnection::spawn(Box::new(stdin), Box::new(stdout), self.progress_tx.clone());

        let handshake = connection.call(
            "engine.version",
            json!({}),
            Duration::from_secs(crate::constants::SIDECAR_RPC_TIMEOUT_SECS),
        );
        let info = match handshake {
            Ok(result) => record_handshake(&result, &self.config.log_path).inspect_err(|_| {
                let _ = spawned.child.kill();
            })?,
            Err(_) => {
                let _ = spawned.child.kill();
                return Err(AppError::engine_crashed(&self.config.log_path));
            }
        };
        *self.last_handshake.lock().expect("last_handshake poisoned") = Some(info);

        state.live = Some(Live {
            child: spawned,
            connection,
        });
        Ok(())
    }

    /// Kills whatever process is live (if any) and clears it, without
    /// touching the restart counter — callers decide whether a kill counts
    /// toward the restart budget.
    fn kill_live(&self, state: &mut MutexGuard<'_, State>) {
        if let Some(mut live) = state.live.take() {
            let _ = live.child.child.kill();
        }
    }

    fn try_restart(&self, state: &mut MutexGuard<'_, State>) -> bool {
        self.kill_live(state);
        if state.restart_count >= self.config.max_restarts.min(SIDECAR_MAX_RESTARTS) {
            return false;
        }
        state.restart_count += 1;
        true
    }

    /// Sends `method`/`params`, ensuring the sidecar is running first.
    /// A transport failure (crash, broken pipe, or a malformed frame that
    /// poisoned the connection — Section 12) restarts the process once
    /// (budget permitting) and surfaces `E_ENGINE_CRASHED`; a timeout kills
    /// the hung process and surfaces `E_ENGINE_TIMEOUT`.
    pub fn call(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, AppError> {
        let mut state = self.state.lock().expect("state poisoned");
        self.ensure_started(&mut state)?;
        let connection_result = state
            .live
            .as_ref()
            .expect("just ensured started")
            .connection
            .call(method, params, timeout);

        match connection_result {
            Ok(value) => Ok(value),
            Err(RpcError::Timeout) => {
                self.kill_live(&mut state);
                Err(AppError::engine_timeout(timeout.as_secs()))
            }
            Err(RpcError::Closed) => {
                self.try_restart(&mut state);
                Err(AppError::engine_crashed(&self.config.log_path))
            }
            Err(RpcError::Remote(error_obj)) => {
                Err(map_remote_error(error_obj, &self.config.log_path))
            }
        }
    }

    /// Best-effort shutdown: asks the sidecar to flush and exit, then kills
    /// it if it hasn't exited promptly.
    pub fn shutdown(&self) {
        let mut state = self.state.lock().expect("state poisoned");
        if let Some(live) = state.live.as_ref() {
            let _ = live
                .connection
                .call("engine.shutdown", json!({}), Duration::from_secs(5));
        }
        self.kill_live(&mut state);
    }
}

/// RAII guard released when an `analyze_repo` call finishes (success or
/// error), clearing the "one analysis at a time" flag.
pub struct AnalysisGuard<'a> {
    supervisor: &'a SidecarSupervisor,
}

impl Drop for AnalysisGuard<'_> {
    fn drop(&mut self) {
        self.supervisor.end_analysis();
    }
}

/// Maps a JSON-RPC `error` object into an `AppError`. The convention this
/// crate and the engine share (see `docs/DECISIONS.md`): a structured
/// domain error (e.g. `E_REPO_TOO_LARGE`) is carried in `error.data` as a
/// serialized `AppError`; anything else falls back to `E_ANALYSIS_FAILED`
/// without leaking the raw remote string into `message`.
///
/// The fallback is deliberately NOT `E_ENGINE_CRASHED`. Reaching this
/// function means the engine RESPONDED — `RpcError::Remote` carries a
/// JSON-RPC `error` object, so the process is alive and answering. A dead
/// transport arrives as `RpcError::Closed` instead, and that is the only
/// path that should claim the engine crashed. v0.1.0 conflated the two, so
/// a deterministic engine-side failure was reported with copy promising
/// that retrying usually works and that the cache keeps completed files —
/// both false for it.
fn map_remote_error(error_obj: Value, log_path: &str) -> AppError {
    if let Some(data) = error_obj.get("data") {
        if let Ok(app_error) = serde_json::from_value::<AppError>(data.clone()) {
            return app_error;
        }
    }
    let fallback = AppError::analysis_failed(log_path);
    match error_obj.get("message").and_then(Value::as_str) {
        Some(raw_message) => fallback.with_detail(raw_message.to_string()),
        None => fallback,
    }
}
