//! Onboard Tauri library crate. `main.rs` is a thin entry point; this file
//! wires plugins, builds `AppState`, resolves the sidecar binary, and
//! registers every Section 7.4 command Phase 6 owns (everything except the
//! `ai_*` family — Phase 12).

pub mod commands;
pub mod constants;
pub mod contract;
pub mod error;
pub mod secrets;
pub mod sidecar;
pub mod state;
pub mod util;

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::Manager;

use secrets::ai_key::AiKeyStore;
use sidecar::supervisor::{SidecarConfig, SidecarSupervisor};
use state::AppState;
use util::logging::RotatingLogger;

/// Current platform's `externalBin` target triple suffix (Tauri's
/// `-<target-triple>` convention — Section 14, "known hard part" #2).
fn target_triple() -> &'static str {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "x86_64-pc-windows-msvc"
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "aarch64-apple-darwin"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "x86_64-apple-darwin"
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        "x86_64-unknown-linux-gnu"
    }
}

/// Resolves the sidecar binary directory: `resource_dir()/binaries` for a
/// packaged app, falling back to the directory next to the running
/// executable in dev (`src-tauri/binaries/`, Section 14).
fn resolve_binaries_dir(app: &tauri::App) -> std::path::PathBuf {
    app.path()
        .resource_dir()
        .map(|dir| dir.join("binaries"))
        .unwrap_or_else(|_| {
            std::env::current_exe()
                .expect("current_exe must resolve")
                .parent()
                .expect("executable must have a parent directory")
                .join("binaries")
        })
}

/// Builds the log path/handle, resolves the sidecar program, and assembles
/// `AppState`. Kept separate from `run()` so `tauri::Builder::setup`'s
/// closure stays a thin call into a single, independently readable function.
fn build_app_state(app: &tauri::App) -> AppState {
    let log_path = app
        .path()
        .app_log_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("onboard")
        .join("onboard.log");
    let logger = RotatingLogger::open(&log_path).expect("failed to open onboard.log");

    let binaries_dir = resolve_binaries_dir(app);
    let program = sidecar::spawn::resolve_sidecar_path(&binaries_dir, target_triple())
        .unwrap_or_else(|| binaries_dir.join("onboard-engine"));

    let supervisor = SidecarSupervisor::new(SidecarConfig {
        program,
        args: vec![],
        log_path: log_path.to_string_lossy().to_string(),
        max_restarts: constants::SIDECAR_MAX_RESTARTS,
    });

    AppState {
        supervisor,
        sessions: Mutex::new(HashMap::new()),
        ai_keys: AiKeyStore::new(),
        logger,
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            app.manage(build_app_state(app));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::pick_repo_folder,
            commands::analyze_repo,
            commands::search_repo,
            commands::read_repo_file,
            commands::get_settings,
            commands::update_settings,
            commands::store_ai_key,
            commands::clear_ai_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Onboard application");
}
