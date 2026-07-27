//! Phase 12 step 3A — the owner's requirement, verbatim: "If an adapter
//! CAN construct a request without passing through the triad, that's a
//! defect — prove it can't." This proves all three legs are simultaneously
//! required at `ai::http::send`'s one call site (the only function in the
//! crate that reaches the network): removing any ONE of `&EgressPermit`
//! (WHETHER), `&ResolvedEndpoint` (WHERE), or `&RedactedPayload` (WHAT) is
//! a compile error, isolated from the other two via `todo!()` per fixture.
//! Same technique as `tests/redaction_compile_fail.rs` /
//! `tests/ai_permit_compile_fail.rs` / `tests/ai_endpoint_compile_fail.rs`
//! (see the first's doc comment for why this shells out to `cargo build`
//! against a tiny external fixture crate instead of using `trybuild`).

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn crate_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn fixture_manifest() -> PathBuf {
    crate_root().join("tests/fixtures/ai-provider-triad-violations/Cargo.toml")
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
/// failed for some reason" (the vacuous-gate trap this phase was warned
/// about repeatedly; the deliberate wrong-code verification that this
/// harness isn't itself vacuous is documented once, in
/// `tests/redaction_compile_fail.rs`'s doc comment, rather than repeated
/// per-suite).
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
fn an_adapter_shaped_caller_cannot_reach_the_wire_without_a_real_permit() {
    assert_fails_with_error_code("missing_permit", "E0308", "EgressPermit");
}

#[test]
fn an_adapter_shaped_caller_cannot_reach_the_wire_without_a_real_endpoint() {
    assert_fails_with_error_code("missing_endpoint", "E0308", "ResolvedEndpoint");
}

#[test]
fn an_adapter_shaped_caller_cannot_reach_the_wire_without_a_real_payload() {
    assert_fails_with_error_code("missing_payload", "E0308", "RedactedPayload");
}

/// Guards against the fixture crate silently rotting — see the identical
/// guard in the other three compile-fail suites.
#[test]
fn all_three_fixture_binaries_exist_on_disk() {
    let bin_dir = crate_root().join("tests/fixtures/ai-provider-triad-violations/src/bin");
    for name in ["missing_permit", "missing_endpoint", "missing_payload"] {
        let path = bin_dir.join(format!("{name}.rs"));
        assert!(
            Path::new(&path).exists(),
            "expected fixture file at {}",
            path.display()
        );
    }
}
