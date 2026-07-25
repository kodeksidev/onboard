//! Resolves and spawns the engine sidecar process.
//!
//! Phase 6 develops against a stub binary (see `bin/onboard_engine_stub.rs`)
//! that speaks the real Section 7.3 protocol; Phase 11 swaps
//! `resolve_sidecar_path` to point at the Phase 5 Bun-compiled binary named
//! per Tauri's `externalBin` `-<target-triple>` convention. Nothing else in
//! `sidecar/` or `commands/` needs to change — they only depend on
//! `SpawnedChild`.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

use crate::error::{AppError, AppErrorCode};

pub struct SpawnedChild {
    pub child: Child,
}

/// Spawns `program` with `args`, wiring stdin/stdout as pipes (for the
/// JSON-RPC transport) and stderr as a pipe too (drained into the log,
/// never surfaced to the UI verbatim — Section 12: no raw OS/provider
/// strings in `AppError.message`).
pub fn spawn_sidecar(program: &Path, args: &[String]) -> Result<SpawnedChild, AppError> {
    let child = Command::new(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| {
            AppError::new(
                AppErrorCode::EEngineCrashed,
                format!("Failed to start the analysis engine process: {err}"),
            )
        })?;
    Ok(SpawnedChild { child })
}

/// Locates the sidecar binary the way Tauri's `externalBin` bundling does:
/// a file named `onboard-engine-<target-triple>[.exe]` next to the running
/// executable (dev: `src-tauri/binaries/`; packaged: the app's resource
/// dir). Falls back to a plain `onboard-engine[.exe]` for local/dev runs
/// where the triple suffix hasn't been applied yet.
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

#[cfg(windows)]
const EXE_SUFFIX: &str = ".exe";
#[cfg(not(windows))]
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
