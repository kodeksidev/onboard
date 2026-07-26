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

pub struct SidecarConfig {
    pub program: PathBuf,
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
        }
    }

    pub fn restart_count(&self) -> u32 {
        self.state.lock().expect("state poisoned").restart_count
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
        let mut spawned = spawn_sidecar(&self.config.program, &self.config.args)?;
        let stdin = spawned.child.stdin.take().expect("stdin was piped");
        let stdout = spawned.child.stdout.take().expect("stdout was piped");
        let connection =
            RpcConnection::spawn(Box::new(stdin), Box::new(stdout), self.progress_tx.clone());

        let handshake = connection.call(
            "engine.version",
            json!({}),
            Duration::from_secs(crate::constants::SIDECAR_RPC_TIMEOUT_SECS),
        );
        match handshake {
            Ok(result) => {
                let contract_version = result.get("contractSchemaVersion").and_then(Value::as_i64);
                if contract_version != Some(CONTRACT_SCHEMA_VERSION) {
                    let _ = spawned.child.kill();
                    return Err(AppError::new(
                        AppErrorCode::EEngineVersionMismatch,
                        format!(
                            "Engine reported contract schema version {contract_version:?}, expected {CONTRACT_SCHEMA_VERSION}."
                        ),
                    ));
                }
            }
            Err(_) => {
                let _ = spawned.child.kill();
                return Err(AppError::engine_crashed(&self.config.log_path));
            }
        }

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
            Err(RpcError::Remote(error_obj)) => Err(map_remote_error(error_obj)),
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
/// serialized `AppError`; anything else falls back to a generic
/// `E_ENGINE_CRASHED` without leaking the raw remote string into `message`.
fn map_remote_error(error_obj: Value) -> AppError {
    if let Some(data) = error_obj.get("data") {
        if let Ok(app_error) = serde_json::from_value::<AppError>(data.clone()) {
            return app_error;
        }
    }
    let fallback = AppError::new(
        AppErrorCode::EEngineCrashed,
        "The analysis engine reported an error it did not describe in a way Onboard understands.",
    );
    match error_obj.get("message").and_then(Value::as_str) {
        Some(raw_message) => fallback.with_detail(raw_message.to_string()),
        None => fallback,
    }
}
