//! Onboard Tauri library crate. `main.rs` is a thin entry point; this file
//! wires plugins, builds `AppState`, resolves the sidecar binary, and
//! registers every Section 7.4 command — Phase 6's, plus Phase 12's
//! `test_ai_key` and the three `ai_*` features.

pub mod ai;
pub mod commands;
pub mod constants;
pub mod contract;
pub mod error;
pub mod privacy;
pub mod secrets;
pub mod sidecar;
pub mod state;
pub mod util;

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::Manager;
use tauri_plugin_shell::ShellExt;

use secrets::ai_key::AiKeyStore;
use sidecar::supervisor::{SidecarConfig, SidecarSupervisor};
use state::AppState;
use util::logging::RotatingLogger;

/// The sidecar's name as declared in `tauri.conf.json`'s `externalBin`
/// (`binaries/onboard-engine`), minus the directory prefix and the
/// `-<target-triple>` suffix Tauri strips when it bundles. This is the
/// string `tauri-plugin-shell` expects.
const SIDECAR_NAME: &str = "onboard-engine";

/// Current platform's `externalBin` target triple suffix (Tauri's
/// `-<target-triple>` convention — Section 14, "known hard part" #2).
///
/// DEV ONLY. Production no longer needs the triple: the plugin resolves the
/// stripped name Tauri actually ships. This remains solely to find the
/// coordinator's staged binaries, which keep their full names.
#[cfg(debug_assertions)]
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

/// Resolves the engine sidecar, delegating to `tauri-plugin-shell`.
///
/// The plugin resolves an `externalBin` **next to the running executable**
/// — where Tauri actually puts it — and applies the platform executable
/// suffix (appending `.exe` on Windows, stripping it elsewhere).
///
/// This replaced a hand-rolled three-step resolver that searched
/// `resource_dir()/binaries`, then `CARGO_MANIFEST_DIR/binaries`, then
/// `current_exe()/../binaries`. Every one of those looks inside a
/// `binaries/` subdirectory that a packaged app does not have, so on a
/// clean machine all three missed and the caller fell through to a
/// CONSTRUCTED path — `<install>/binaries/onboard-engine`, without even the
/// `.exe` — producing `os error 3` (ERROR_PATH_NOT_FOUND: the *directory*
/// is absent, which is why it was not the `os error 2` a missing file
/// gives). The executable-suffix bug in that fallback is one of the things
/// the plugin gets right for free.
///
/// Returns `Err` rather than a constructed path: a release build that
/// cannot find its engine must say so, not hand the caller a path that
/// exists nowhere.
fn resolve_sidecar_program(app: &tauri::App) -> Result<std::path::PathBuf, String> {
    // `Shell::sidecar` hands back the plugin's `Command`; `From<Command>
    // for std::process::Command` lets us take just the resolved program and
    // keep this crate's own `std::process` supervisor, which owns the
    // long-lived stdio JSON-RPC transport and the restart budget. The
    // plugin's async event-stream spawn model would not express those.
    let command: std::process::Command = app
        .shell()
        .sidecar(SIDECAR_NAME)
        .map_err(|error| format!("could not resolve the {SIDECAR_NAME} sidecar: {error}"))?
        .into();
    let packaged = std::path::PathBuf::from(command.get_program());
    if packaged.is_file() {
        return Ok(packaged);
    }

    #[cfg(debug_assertions)]
    {
        // `cargo build` performs no `externalBin` copy — only `tauri build`
        // does — so a debug build has nothing beside its executable. The
        // coordinator stages real sidecars under their full triple-suffixed
        // names, which the plugin does not look for; this is the one thing
        // its API cannot express, and it is dev-only by construction.
        let staged = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
        if let Some(path) = sidecar::spawn::resolve_sidecar_path(&staged, target_triple()) {
            return Ok(path);
        }
    }

    Err(format!(
        "the {SIDECAR_NAME} sidecar is not installed at {}",
        packaged.display()
    ))
}

/// Resolves the tree-sitter grammar WASM directory the same way (Section
/// 14 "known hard part" #1: the grammar loader takes a path argument and
/// has no hardcoded fallback). Declared `resources` (unlike `externalBin`)
/// ARE copied next to the dev executable by `tauri-build` itself, so
/// `resource_dir()/resources/grammars` already works in both dev and a
/// packaged build; the compile-time fallback exists only for the case this
/// crate is built without ever having run through `tauri-build` at all.
fn resolve_grammars_dir(app: &tauri::App) -> std::path::PathBuf {
    if let Ok(dir) = app.path().resource_dir() {
        let candidate = dir.join("resources").join("grammars");
        if candidate.is_dir() {
            return candidate;
        }
    }
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("grammars")
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

    // A failure here is recorded, not fatal and not papered over: the window
    // still opens (so the user sees Onboard's own error state rather than a
    // silent non-start), and the first analysis returns
    // E_ENGINE_NOT_STARTED. The reason goes to the log, which that copy
    // names.
    // Both outcomes are logged, and the SUCCESS line is load-bearing: it is
    // what `installed-app-check.py` asserts against a real installed package.
    // A check that only looked for the failure line would pass on an app that
    // never got as far as resolving anything — absence of an error is not
    // evidence of success (SECURITY_AUDIT.md's non-vacuity rule).
    let program = match resolve_sidecar_program(app) {
        Ok(path) => {
            let _ = logger.log_line(&format!("sidecar resolved: {}", path.display()));
            Some(path)
        }
        Err(reason) => {
            let _ = logger.log_line(&format!("sidecar resolution failed: {reason}"));
            None
        }
    };
    let grammars_dir = resolve_grammars_dir(app);

    let supervisor = SidecarSupervisor::new(SidecarConfig {
        program,
        args: vec![
            "--grammars-dir".to_string(),
            grammars_dir.to_string_lossy().to_string(),
        ],
        log_path: log_path.to_string_lossy().to_string(),
        max_restarts: constants::SIDECAR_MAX_RESTARTS,
    });

    AppState {
        supervisor,
        sessions: Mutex::new(HashMap::new()),
        ai_keys: AiKeyStore::new(),
        ai_rate_limiter: ai::rate_limit::AiRateLimiter::new(),
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
            commands::test_ai_key,
            commands::ai_project_summary,
            commands::ai_explain_module,
            commands::ai_ask,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Onboard application");
}
