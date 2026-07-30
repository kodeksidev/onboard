//! Shared helpers for the integration tests.

use std::path::PathBuf;

/// Resolves the `onboard_engine_stub` binary by path.
///
/// It used to be `env!("CARGO_BIN_EXE_onboard_engine_stub")`, which Cargo
/// only populates for bins belonging to the package under test. The stub now
/// lives in the sibling `onboard-dev-tools` crate — it had to leave `onboard`
/// because Tauri's bundler bundles that package's bin targets, and a
/// fixture-replaying fake engine has no business in a user's install.
///
/// `dev-tools` is a workspace member, so it shares `src-tauri/target/` and the
/// binary lands exactly where it always did: `target/<profile>/`. This
/// resolves it from the test executable's own location — the same technique
/// `src/commands/ai.rs`'s `stub_sidecar_path` already uses, for the same
/// reason (an integration test binary lives at `target/<profile>/deps/`, so
/// the bins sit one directory up).
pub fn stub_program() -> PathBuf {
    let exe = std::env::current_exe().expect("current_exe must resolve");
    let target_dir = exe
        .parent()
        .and_then(std::path::Path::parent)
        .expect("test binary must live at target/<profile>/deps/");
    let name = if cfg!(windows) {
        "onboard_engine_stub.exe"
    } else {
        "onboard_engine_stub"
    };
    let candidate = target_dir.join(name);
    assert!(
        candidate.exists(),
        "stub sidecar not found at {} — build it first: \
         `cargo build -p onboard-dev-tools --bin onboard_engine_stub`",
        candidate.display()
    );
    candidate
}
