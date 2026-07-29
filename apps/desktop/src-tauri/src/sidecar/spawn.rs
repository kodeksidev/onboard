//! Spawns the engine sidecar process.
//!
//! Phase 6 develops against a stub binary (see `bin/onboard_engine_stub.rs`)
//! that speaks the real Section 7.3 protocol. Nothing else in `sidecar/` or
//! `commands/` depends on how the program path was obtained — they only
//! depend on `SpawnedChild`.
//!
//! Production resolution of that path does NOT live here: `lib.rs` asks
//! `tauri-plugin-shell` for it. The only resolver left in this file is the
//! dev-staging one, gated `#[cfg(debug_assertions)]`.

use std::path::Path;
use std::process::{Child, Command, Stdio};

#[cfg(debug_assertions)]
use std::path::PathBuf;

use crate::error::AppError;

pub struct SpawnedChild {
    pub child: Child,
}

/// Spawns `program` with `args`, wiring stdin/stdout as pipes (for the
/// JSON-RPC transport) and stderr as a pipe too (drained into the log,
/// never surfaced to the UI verbatim — Section 12: no raw OS/provider
/// strings in `AppError.message`).
/// `log_path` is threaded through so the Section 10 copy can name it, the
/// same way `E_ENGINE_CRASHED` does.
pub fn spawn_sidecar(
    program: &Path,
    args: &[String],
    log_path: &str,
) -> Result<SpawnedChild, AppError> {
    let child = Command::new(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        // Section 12: the OS string ("The system cannot find the path
        // specified. (os error 3)") goes in `detail`, behind the UI's
        // Details disclosure — never in `message`, which is the copy the
        // user reads. The code is E_ENGINE_NOT_STARTED, not
        // E_ENGINE_CRASHED: `spawn` failing means no process ever existed.
        .map_err(|err| AppError::engine_not_started(log_path).with_detail(err.to_string()))?;
    Ok(SpawnedChild { child })
}

/// DEV ONLY — locates a sidecar in the coordinator's staging directory
/// (`src-tauri/binaries/`), where `bun run stage:sidecar` leaves binaries
/// under their full `onboard-engine-<target-triple>[.exe]` names.
///
/// This is **not** how a packaged app finds its sidecar, despite what this
/// function's doc comment claimed until 2026-07-29. Tauri copies an
/// `externalBin` **next to the main executable** with the triple suffix
/// STRIPPED — not into a `binaries/` subdirectory, and not into the
/// resource dir. `lib.rs` now delegates that resolution to
/// `tauri-plugin-shell`, which gets it right; this remains only because a
/// plain `cargo build` performs no such copy (only `tauri build` does), so
/// a debug build has nothing beside its executable to find.
///
/// Gated `#[cfg(debug_assertions)]` deliberately: it resolves against the
/// BUILD machine's source tree, which does not exist on a user's machine.
/// While a release build could reach it, every developer machine resolved
/// and the only configuration that failed was the one no test ran.
#[cfg(debug_assertions)]
pub fn resolve_sidecar_path(binaries_dir: &Path, target_triple: &str) -> Option<PathBuf> {
    let suffixed = binaries_dir.join(format!("onboard-engine-{target_triple}{EXE_SUFFIX}"));
    if suffixed.exists() {
        return Some(suffixed);
    }
    let plain = binaries_dir.join(format!("onboard-engine{EXE_SUFFIX}"));
    if plain.exists() {
        return Some(plain);
    }
    None
}

#[cfg(all(windows, debug_assertions))]
const EXE_SUFFIX: &str = ".exe";
#[cfg(all(not(windows), debug_assertions))]
const EXE_SUFFIX: &str = "";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_the_triple_suffixed_binary_when_present() {
        let dir = tempfile::tempdir().unwrap();
        let triple = "x86_64-pc-windows-msvc";
        std::fs::write(
            dir.path()
                .join(format!("onboard-engine-{triple}{EXE_SUFFIX}")),
            b"stub",
        )
        .unwrap();

        let resolved = resolve_sidecar_path(dir.path(), triple);
        assert!(resolved.is_some());
        assert!(resolved.unwrap().to_string_lossy().contains(triple));
    }

    #[test]
    fn falls_back_to_the_plain_name_in_dev() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join(format!("onboard-engine{EXE_SUFFIX}")),
            b"stub",
        )
        .unwrap();

        let resolved = resolve_sidecar_path(dir.path(), "does-not-exist-triple");
        assert!(resolved.is_some());
    }

    #[test]
    fn returns_none_when_neither_name_exists() {
        let dir = tempfile::tempdir().unwrap();
        assert!(resolve_sidecar_path(dir.path(), "x86_64-pc-windows-msvc").is_none());
    }
}
