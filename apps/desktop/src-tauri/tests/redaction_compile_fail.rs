//! Phase 12 step 1d: proves bypassing `privacy::redact`'s type-safety is a
//! COMPILE ERROR, not just an unenforced convention.
//!
//! Each `tests/fixtures/redaction-violations/src/bin/*.rs` file is a tiny,
//! REAL external crate (its own `Cargo.toml`, depending on this crate by
//! path) that attempts one specific violation. This test `cargo build`s
//! each one and asserts two things: it fails (non-zero exit), AND the
//! stderr names the ACTUAL violation via its rustc error CODE — not just
//! "some error happened for some reason". That second assertion is the
//! whole point: a compile-fail check that only verifies "did it fail"
//! passes just as happily on an unrelated typo as on the real guarantee,
//! which is exactly the kind of vacuous gate this phase was warned about.
//!
//! ## Why not `trybuild`
//!
//! `trybuild`'s default `compile_fail` mode does the plumbing (finding
//! rlibs, invoking rustc against the current crate) very well, but its
//! pass/fail verdict is an EXACT comparison against a committed `.stderr`
//! snapshot — full rendered text, including line/column numbers. That
//! snapshot is brittle across rustc versions for reasons that have nothing
//! to do with whether the actual guarantee still holds (a wording tweak in
//! a future rustc breaks the test even though the field is still private).
//! Shelling out to `cargo build` directly and asserting on the stable
//! error CODE (`E0451`, `E0599`, `E0277`) plus a keyword substring is more
//! verbose but survives a compiler upgrade's cosmetic changes while still
//! failing loudly if the WRONG error appears (e.g. a typo producing an
//! unrelated `E0432` unresolved-import error would fail this test's
//! specific-substring assertion, exactly as it should).
//!
//! Each fixture's `--target-dir` points at this crate's OWN `target/`
//! (shared, not a fresh one per fixture) so `onboard_lib` and its
//! dependencies are compiled once and reused — confirmed empirically: the
//! first fixture takes ~25-30s (compiling `onboard_lib` itself), every
//! fixture after that takes well under a second.

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn crate_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn fixture_manifest() -> PathBuf {
    crate_root().join("tests/fixtures/redaction-violations/Cargo.toml")
}

fn shared_target_dir() -> PathBuf {
    crate_root().join("target")
}

fn build_fixture_bin(bin_name: &str) -> Output {
    Command::new("cargo")
        .args(["build", "--quiet", "--bin", bin_name, "--manifest-path"])
        .arg(fixture_manifest())
        .arg("--target-dir")
        .arg(shared_target_dir())
        .output()
        .unwrap_or_else(|err| {
            panic!("failed to invoke `cargo build` for fixture `{bin_name}`: {err}")
        })
}

/// Asserts `bin_name` fails to compile AND that the failure names the
/// specific violation (`expected_error_code`, e.g. `"E0451"`) — never just
/// "compilation failed for some reason".
fn assert_fails_with_error_code(bin_name: &str, expected_error_code: &str, expected_keyword: &str) {
    let output = build_fixture_bin(bin_name);
    let stderr = String::from_utf8_lossy(&output.stderr);

    assert!(
        !output.status.success(),
        "fixture `{bin_name}` was expected to fail to compile, but it succeeded.\nstderr:\n{stderr}"
    );
    assert!(
        stderr.contains(expected_error_code),
        "fixture `{bin_name}` failed, but not with {expected_error_code} as expected — this would be a \
         vacuous compile-fail test (failing for the wrong reason). Actual stderr:\n{stderr}"
    );
    assert!(
        stderr.contains(expected_keyword),
        "fixture `{bin_name}` failed with {expected_error_code}, but the message didn't mention \
         {expected_keyword:?} as expected. Actual stderr:\n{stderr}"
    );
}

#[test]
fn constructing_redacted_payload_by_struct_literal_is_a_compile_error() {
    assert_fails_with_error_code("struct_literal", "E0451", "private");
}

#[test]
fn calling_a_nonexistent_redacted_payload_constructor_is_a_compile_error() {
    assert_fails_with_error_code("no_constructor", "E0599", "new");
}

#[test]
fn defaulting_a_redacted_payload_is_a_compile_error() {
    assert_fails_with_error_code("default_impl", "E0277", "Default");
}

#[test]
fn deserializing_a_redacted_payload_is_a_compile_error() {
    assert_fails_with_error_code("deserialize", "E0277", "Deserialize");
}

/// Guards against the fixture crate silently rotting (e.g. someone renames
/// a `.rs` file and the harness above starts building nothing, "passing"
/// on stale cached binaries) by asserting the fixture directory's shape.
#[test]
fn all_four_fixture_binaries_exist_on_disk() {
    let bin_dir = crate_root().join("tests/fixtures/redaction-violations/src/bin");
    for name in [
        "struct_literal",
        "no_constructor",
        "default_impl",
        "deserialize",
    ] {
        let path = bin_dir.join(format!("{name}.rs"));
        assert!(
            Path::new(&path).exists(),
            "expected fixture file at {}",
            path.display()
        );
    }
}
