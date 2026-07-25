pub mod analyze;
pub mod read_file;
pub mod search;
pub mod settings;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::error::AppError;
use crate::state::AppState;

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

    analyze_repo_core(
        &state,
        AnalyzeRepoRequest {
            path,
            is_force_refresh,
        },
        AnalyzeContext {
            app_data_dir: app_data_dir.to_string_lossy().to_string(),
            exclude_globs: settings.exclude_globs,
        },
    )
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
