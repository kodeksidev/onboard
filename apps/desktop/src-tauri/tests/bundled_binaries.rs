//! The shipped binary set is exactly one, asserted structurally.
//!
//! Tauri's bundler enumerates the BUNDLED PACKAGE's `[[bin]]` targets and
//! bundles every one. v0.1.0 therefore shipped `onboard_engine_stub.exe` — a
//! fixture-replaying FAKE ENGINE — and `check_egress_chokepoint.exe`, a
//! build-time source checker, into users' installs. Nobody decided that: one
//! was declared for tests, the other was auto-discovered from `src/bin/`.
//!
//! `scripts/installed-app-check.py` catches it in the produced installer, by
//! set equality over the shipped files. That check is downstream: it needs a
//! bundle, a runner, and a release workflow to fire. This one is upstream and
//! structural — it fails in `cargo test`, on the manifest itself, the moment a
//! second bin target appears. Re-adding one becomes a deliberate, visible
//! change instead of an accident nobody sees until a user does.

use std::path::PathBuf;
use std::process::Command;

/// Every binary this package is allowed to ship.
const SHIPPED_BINARIES: &[&str] = &["onboard"];

#[test]
fn bundled_package_ships_exactly_one_binary() {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
    let output = Command::new(option_env!("CARGO").unwrap_or("cargo"))
        .args(["metadata", "--no-deps", "--format-version", "1"])
        .arg("--manifest-path")
        .arg(&manifest)
        .output()
        .expect("cargo metadata must run");
    assert!(
        output.status.success(),
        "cargo metadata failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let metadata: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("cargo metadata emits JSON");

    let packages = metadata["packages"]
        .as_array()
        .expect("cargo metadata always has a packages array");
    let onboard = packages
        .iter()
        .find(|p| p["name"] == "onboard")
        .expect("the `onboard` package must appear in its own metadata");

    let mut actual: Vec<String> = onboard["targets"]
        .as_array()
        .expect("a package always has a targets array")
        .iter()
        .filter(|t| {
            t["kind"]
                .as_array()
                .is_some_and(|kinds| kinds.iter().any(|k| k == "bin"))
        })
        .filter_map(|t| t["name"].as_str().map(str::to_string))
        .collect();

    // Non-vacuity: if the filter matched nothing, this test would "pass" on a
    // package that ships anything at all.
    assert!(
        actual.iter().any(|name| name == "onboard"),
        "found no `onboard` bin target — the query is wrong, and a check that \
         finds nothing is not a check. Found: {actual:?}"
    );

    let mut expected: Vec<String> = SHIPPED_BINARIES.iter().map(|s| (*s).to_string()).collect();
    expected.sort();
    actual.sort();

    assert_eq!(
        actual, expected,
        "\nThe `onboard` package's bin targets changed, and Tauri's bundler \
         ships every one of them.\n\
         If this is deliberate, the new binary WILL be installed on users' \
         machines — update SHIPPED_BINARIES and say so in the manifest.\n\
         If it is a developer tool, it belongs in `dev-tools/` (a workspace \
         member, so its output path does not move).\n"
    );
}
