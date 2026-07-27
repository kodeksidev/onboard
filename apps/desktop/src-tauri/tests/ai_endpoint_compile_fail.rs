//! Phase 12 step 2 follow-up (the WHERE gap): proves `ai::http::send` is
//! unreachable with a bare `&str`/`String` endpoint, that `ResolvedEndpoint`
//! itself cannot be forged by any route, and that `StoredAiSettings` cannot
//! be manufactured from a caller-supplied `AiSettings` either — same
//! technique as `tests/redaction_compile_fail.rs` /
//! `tests/ai_permit_compile_fail.rs` (see the former's doc comment for why
//! this shells out to `cargo build` against a tiny external fixture crate
//! instead of using `trybuild`).

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn crate_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn fixture_manifest() -> PathBuf {
    crate_root().join("tests/fixtures/ai-endpoint-violations/Cargo.toml")
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
/// about twice already; the deliberate wrong-code check that verifies this
/// harness isn't itself vacuous is documented in
/// `tests/redaction_compile_fail.rs`'s doc comment rather than repeated
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
fn constructing_resolved_endpoint_by_struct_literal_is_a_compile_error() {
    assert_fails_with_error_code("struct_literal", "E0451", "private");
}

#[test]
fn calling_a_nonexistent_resolved_endpoint_constructor_is_a_compile_error() {
    assert_fails_with_error_code("no_constructor", "E0599", "new");
}

#[test]
fn defaulting_a_resolved_endpoint_is_a_compile_error() {
    assert_fails_with_error_code("default_impl", "E0277", "Default");
}

#[test]
fn deserializing_a_resolved_endpoint_is_a_compile_error() {
    assert_fails_with_error_code("deserialize", "E0277", "Deserialize");
}

#[test]
fn converting_an_owned_string_into_a_resolved_endpoint_is_a_compile_error() {
    assert_fails_with_error_code("from_string", "E0277", "From<String>");
}

#[test]
fn converting_a_str_slice_into_a_resolved_endpoint_is_a_compile_error() {
    assert_fails_with_error_code("from_str", "E0277", "From<&str>");
}

/// The old `send(.., endpoint: &str, ..)` call shape is gone entirely, not
/// merely unused — a literal string can no longer be passed where an
/// endpoint is expected.
#[test]
fn calling_send_with_a_str_endpoint_is_a_compile_error() {
    assert_fails_with_error_code("send_with_str_endpoint", "E0308", "ResolvedEndpoint");
}

/// The other half of "WHERE it goes": `StoredAiSettings` cannot be
/// manufactured from a caller-built `AiSettings` by struct literal — its
/// one field is private.
#[test]
fn constructing_stored_ai_settings_by_tuple_struct_literal_is_a_compile_error() {
    assert_fails_with_error_code("stored_settings_struct_literal", "E0603", "private");
}

/// ...nor via `From`/`Into` — there is no conversion at all.
#[test]
fn converting_ai_settings_into_stored_ai_settings_is_a_compile_error() {
    assert_fails_with_error_code(
        "stored_settings_from_ai_settings",
        "E0277",
        "StoredAiSettings",
    );
}

/// Guards against the fixture crate silently rotting — see the identical
/// guard in `tests/redaction_compile_fail.rs` / `tests/ai_permit_compile_fail.rs`.
#[test]
fn all_nine_fixture_binaries_exist_on_disk() {
    let bin_dir = crate_root().join("tests/fixtures/ai-endpoint-violations/src/bin");
    for name in [
        "struct_literal",
        "no_constructor",
        "default_impl",
        "deserialize",
        "from_string",
        "from_str",
        "send_with_str_endpoint",
        "stored_settings_struct_literal",
        "stored_settings_from_ai_settings",
    ] {
        let path = bin_dir.join(format!("{name}.rs"));
        assert!(
            Path::new(&path).exists(),
            "expected fixture file at {}",
            path.display()
        );
    }
}
