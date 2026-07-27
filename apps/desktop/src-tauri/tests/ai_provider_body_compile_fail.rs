//! Phase 12 step 3A, Part A — the owner's ruling: a free-form
//! `body: &serde_json::Value` parameter is the same defect pattern as the
//! three already-closed legs (WHAT/WHETHER/WHERE), so it was deleted from
//! `ai::http::send`, not deprecated. Proves an adapter cannot put content
//! into the outbound body, because no parameter exists through which it
//! could — both by arity (the deleted parameter's slot is simply gone) and
//! by type (nothing resembling `serde_json::Value` fits anywhere in the
//! signature). Same technique as the other four compile-fail suites (see
//! `tests/redaction_compile_fail.rs`'s doc comment for why this shells out
//! to `cargo build` against a tiny external fixture crate instead of using
//! `trybuild`).

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn crate_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn fixture_manifest() -> PathBuf {
    crate_root().join("tests/fixtures/ai-provider-body-violations/Cargo.toml")
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

/// The clearest arity proof: `send` takes exactly six parameters; a
/// seventh (standing in for the deleted `body` argument) doesn't fit.
#[test]
fn an_extra_body_argument_does_not_fit_sends_signature_at_all() {
    assert_fails_with_error_code("extra_body_argument", "E0061", "6 arguments");
}

/// The type proof: even trying to smuggle raw content into an EXISTING
/// slot (`model: &str`) fails, because nothing resembling a JSON blob
/// fits any parameter type in the signature.
#[test]
fn raw_json_content_cannot_be_smuggled_into_the_model_slot() {
    assert_fails_with_error_code("raw_content_into_model_slot", "E0308", "&str");
}

/// Guards against the fixture crate silently rotting — see the identical
/// guard in the other four compile-fail suites.
#[test]
fn both_fixture_binaries_exist_on_disk() {
    let bin_dir = crate_root().join("tests/fixtures/ai-provider-body-violations/src/bin");
    for name in ["extra_body_argument", "raw_content_into_model_slot"] {
        let path = bin_dir.join(format!("{name}.rs"));
        assert!(
            Path::new(&path).exists(),
            "expected fixture file at {}",
            path.display()
        );
    }
}
