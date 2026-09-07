pub mod ai;
pub mod analyze;
pub mod read_file;
pub mod search;
pub mod settings;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::AppError;
use crate::state::AppState;

use ai::{
    ai_ask_core, ai_explain_module_core, ai_project_summary_core, test_ai_key_core, AiAnswer,
    AiCommandContext, TestAiKeyResponse,
};
use analyze::{analyze_repo_core, AnalyzeContext, AnalyzeRepoRequest};
use read_file::read_repo_file_core;
use search::search_repo_core;
use settings::{
    clear_ai_key_core, get_settings_core, store_ai_key_core, update_settings_core,
    validate_provider, Settings, SettingsPatch, StoreAiKeyResponse,
};

use crate::contract::{AnalysisEnvelope, FileContent, SearchResponse};

fn settings_path(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("onboard").join("settings.json"))
        .map_err(|_| AppError::invalid_settings("Could not resolve the app config directory."))
}

/// `engine.progress` notification fan-out (Section 7.3/7.4): mirrored to the
/// webview as `onboard://analysis-progress` while `engine.analyze` is in
/// flight. Polls `SidecarSupervisor::progress_rx` on a plain thread — this
/// crate's RPC layer (`sidecar::rpc`) is synchronous by design, so a thread
/// with a short poll timeout (rather than an async task) is what lets it
/// notice the stop signal promptly once the blocking analyze call returns.
const PROGRESS_POLL_INTERVAL: Duration = Duration::from_millis(100);
const ANALYSIS_PROGRESS_EVENT: &str = "onboard://analysis-progress";

fn spawn_progress_forwarder(app: AppHandle) -> impl FnOnce() {
    let stop = Arc::new(AtomicBool::new(false));
    let stop_for_thread = stop.clone();
    let handle = std::thread::spawn(move || {
        while !stop_for_thread.load(Ordering::Relaxed) {
            let received = {
                let state = app.state::<AppState>();
                let rx = state
                    .supervisor
                    .progress_rx
                    .lock()
                    .expect("progress_rx poisoned");
                rx.recv_timeout(PROGRESS_POLL_INTERVAL)
            };
            if let Ok((method, params)) = received {
                if method == "engine.progress" {
                    let _ = app.emit(ANALYSIS_PROGRESS_EVENT, params);
                }
            }
        }
    });
    move || {
        stop.store(true, Ordering::Relaxed);
        let _ = handle.join();
    }
}

/// Section 7.4: `pick_repo_folder` returns `{ path: string | null }`, not a
/// bare nullable string — the wire shape is a frozen object even though it
/// carries a single field.
#[derive(Debug, Clone, Serialize)]
pub struct PickRepoFolderResponse {
    pub path: Option<String>,
}

#[tauri::command]
pub async fn pick_repo_folder(app: AppHandle) -> Result<PickRepoFolderResponse, AppError> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder);
    });
    let picked = rx
        .recv()
        .map_err(|_| AppError::invalid_settings("The folder picker closed unexpectedly."))?;
    Ok(PickRepoFolderResponse {
        path: picked.map(|p| p.to_string()),
    })
}

#[tauri::command]
pub fn analyze_repo(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    is_force_refresh: bool,
) -> Result<AnalysisEnvelope, AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::invalid_settings("Could not resolve the app data directory."))?;
    let settings = get_settings_core(&settings_path(&app)?, &state.ai_keys);

    let stop_progress_forwarder = spawn_progress_forwarder(app.clone());
    let result = analyze_repo_core(
        &state,
        AnalyzeRepoRequest {
            path,
            is_force_refresh,
        },
        AnalyzeContext {
            app_data_dir: app_data_dir.to_string_lossy().to_string(),
            exclude_globs: settings.exclude_globs,
        },
    );
    stop_progress_forwarder();
    result.map_err(|error| state.log_app_error(error))
}

#[tauri::command]
pub fn search_repo(
    state: State<'_, AppState>,
    repo_id: String,
    query: String,
    limit: Option<u32>,
) -> Result<SearchResponse, AppError> {
    search_repo_core(&state, repo_id, query, limit.unwrap_or(50))
}

#[tauri::command]
pub fn read_repo_file(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
) -> Result<FileContent, AppError> {
    read_repo_file_core(&state, repo_id, path)
}

#[tauri::command]
pub fn get_settings(app: AppHandle, state: State<'_, AppState>) -> Result<Settings, AppError> {
    Ok(get_settings_core(&settings_path(&app)?, &state.ai_keys))
}

/// The app version is `Some` for `Settings`/`About`, whatever engine the
/// running process last actually talked to for the other three — `None`
/// until the first successful `engine.version` handshake (before any
/// analysis, or if the sidecar was never found at all), so a user comparing
/// this against a bug report can tell "no analysis has run yet" apart from
/// "the engine answered with X" rather than seeing a blank/stale value in
/// either case.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
    pub app_version: String,
    pub engine_version: Option<String>,
    pub contract_schema_version: Option<i64>,
    pub grammar_fingerprint: Option<String>,
}

#[tauri::command]
pub fn get_engine_info(app: AppHandle, state: State<'_, AppState>) -> Result<EngineInfo, AppError> {
    let handshake = state.supervisor.last_handshake();
    Ok(EngineInfo {
        app_version: app.package_info().version.to_string(),
        engine_version: handshake.as_ref().map(|h| h.engine_version.clone()),
        contract_schema_version: handshake.as_ref().map(|h| h.contract_schema_version),
        grammar_fingerprint: handshake.map(|h| h.grammar_fingerprint),
    })
}

#[tauri::command]
pub fn update_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    patch: SettingsPatch,
) -> Result<Settings, AppError> {
    update_settings_core(&settings_path(&app)?, &state.ai_keys, patch)
}

#[tauri::command]
pub fn store_ai_key(
    state: State<'_, AppState>,
    provider: String,
    api_key: String,
) -> Result<StoreAiKeyResponse, AppError> {
    validate_provider(&provider)?;
    store_ai_key_core(&state.ai_keys, &provider, &api_key)
}

/// Section 7.4's `clear_ai_key` response is the literal empty object `{}`,
/// not JSON `null` (which is what Rust's `()` would serialize to).
#[derive(Debug, Clone, Serialize)]
pub struct EmptyResponse {}

#[tauri::command]
pub fn clear_ai_key(
    state: State<'_, AppState>,
    provider: String,
) -> Result<EmptyResponse, AppError> {
    validate_provider(&provider)?;
    clear_ai_key_core(&state.ai_keys, &provider)?;
    Ok(EmptyResponse {})
}

/// Section 7.4: `test_ai_key`. `async fn` (unlike every other command in
/// this file except `pick_repo_folder`) so Tauri's own async runtime — a
/// dependency of `tauri` itself, not this crate directly — drives
/// `ai::provider::AiProvider`'s async methods for real; see
/// `commands::ai`'s doc comment for why this proves the full chokepoint
/// rather than a lighter-weight credential check. Everything needed is
/// read out of `app`/`state` BEFORE the first `.await`, so neither is held
/// across a suspension point.
#[tauri::command]
pub async fn test_ai_key(
    app: AppHandle,
    state: State<'_, AppState>,
    provider: String,
    model: String,
) -> Result<TestAiKeyResponse, AppError> {
    validate_provider(&provider)?;
    // M1: the connectivity probe now runs the traced pipeline, so it needs
    // the same context the feature commands build — `transcripts_dir`
    // included, because the probe writes a transcript entry before sending.
    let ctx = ai_command_context(&app, &state)?;
    let path = ctx.settings_path.clone();
    let ai_keys = ctx.ai_keys.clone();
    test_ai_key_core(
        &state,
        &ctx.transcripts_dir,
        path,
        ai_keys,
        &provider,
        &model,
    )
    .await
}

/// Section 12: the AI transcript lives at
/// `<appDataDir>/onboard/transcripts/<repoId>.jsonl`.
fn ai_command_context(
    app: &AppHandle,
    state: &State<'_, AppState>,
) -> Result<AiCommandContext, AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::invalid_settings("Could not resolve the app data directory."))?;
    Ok(AiCommandContext {
        settings_path: settings_path(app)?,
        transcripts_dir: app_data_dir.join("onboard").join("transcripts"),
        ai_keys: state.ai_keys.clone(),
        #[cfg(test)]
        test_endpoint: None,
    })
}

/// Section 7.4: `ai_project_summary { repoId }` →
/// `{ markdown, citedPaths, sentFileCount, sentByteCount }`.
#[tauri::command]
pub async fn ai_project_summary(
    app: AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<AiAnswer, AppError> {
    let ctx = ai_command_context(&app, &state)?;
    ai_project_summary_core(&state, ctx, &repo_id).await
}

/// Section 7.4: `ai_explain_module { repoId, moduleId }` — same response
/// shape.
#[tauri::command]
pub async fn ai_explain_module(
    app: AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    module_id: String,
) -> Result<AiAnswer, AppError> {
    let ctx = ai_command_context(&app, &state)?;
    ai_explain_module_core(&state, ctx, &repo_id, &module_id).await
}

/// Section 7.4: `ai_ask { repoId, question }` — same response shape.
#[tauri::command]
pub async fn ai_ask(
    app: AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    question: String,
) -> Result<AiAnswer, AppError> {
    let ctx = ai_command_context(&app, &state)?;
    ai_ask_core(&state, ctx, &repo_id, &question).await
}
