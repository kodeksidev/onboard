//! Phase 12 step 2b: proves `ai::http::send` is unreachable without a real
//! `EgressPermit`, and that `EgressPermit` itself cannot be forged — same
//! technique and same rationale as `tests/redaction_compile_fail.rs`
//! (see that file's doc comment for why this shells out to `cargo build`
//! against a tiny external fixture crate instead of using `trybuild`).

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn crate_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn fixture_manifest() -> PathBuf {
    crate_root().join("tests/fixtures/egress-permit-violations/Cargo.toml")
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
/// specific violation (`expected_error_code`) — never just "compilation
/// failed for some reason" (the exact vacuous-gate trap this phase was
/// warned about; verified not to be one the same way step 1's suite was:
/// see `tests/redaction_compile_fail.rs`'s doc comment).
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
         vacuous compile-fail test. Actual stderr:\n{stderr}"
    );
    assert!(
        stderr.contains(expected_keyword),
        "fixture `{bin_name}` failed with {expected_error_code}, but the message didn't mention \
         {expected_keyword:?} as expected. Actual stderr:\n{stderr}"
    );
}

#[test]
fn constructing_egress_permit_by_struct_literal_is_a_compile_error() {
    assert_fails_with_error_code("struct_literal", "E0451", "private");
}

#[test]
fn calling_a_nonexistent_egress_permit_constructor_is_a_compile_error() {
    assert_fails_with_error_code("no_constructor", "E0599", "new");
}

#[test]
fn defaulting_an_egress_permit_is_a_compile_error() {
    assert_fails_with_error_code("default_impl", "E0277", "Default");
}

#[test]
fn deserializing_an_egress_permit_is_a_compile_error() {
    assert_fails_with_error_code("deserialize", "E0277", "Deserialize");
}

#[test]
fn calling_send_without_a_real_egress_permit_is_a_compile_error() {
    assert_fails_with_error_code("send_without_permit", "E0308", "EgressPermit");
}

/// Guards against the fixture crate silently rotting — see the identical
/// guard in `tests/redaction_compile_fail.rs`.
#[test]
fn all_five_fixture_binaries_exist_on_disk() {
    let bin_dir = crate_root().join("tests/fixtures/egress-permit-violations/src/bin");
    for name in [
        "struct_literal",
        "no_constructor",
        "default_impl",
        "deserialize",
        "send_without_permit",
    ] {
        let path = bin_dir.join(format!("{name}.rs"));
        assert!(
            Path::new(&path).exists(),
            "expected fixture file at {}",
            path.display()
        );
    }
}
