//! Phase 12 step 2c — "the exactly-one-door check": Section 12's egress
//! chokepoint enforcement, made into a real, testable program instead of an
//! inline CI shell one-liner.
//!
//! ## The conflict (read `docs/DECISIONS.md`'s matching entry for the full
//! writeup) and its resolution
//!
//! Taken completely literally, "assert `hyper, ureq, curl, isahc, surf,
//! attohttpc, rustls, native-tls, openssl, tungstenite` appear nowhere" is
//! unsatisfiable the moment `reqwest` exists at all: `reqwest` depends on
//! `hyper`, and its `rustls-tls` feature pulls in `rustls` — both
//! necessarily appear in `Cargo.lock` and in `cargo tree`'s output
//! permanently. A check against the full dependency tree would fail
//! immediately and forever. The strongest COHERENT version — implemented
//! below — separates two different questions:
//!
//! 1. **Direct dependencies** (`check_cargo_dependencies`): reads only the
//!    `[dependencies]` table of `Cargo.toml` (not `Cargo.lock`, not the
//!    resolved/transitive graph). Exactly one HTTP client — `reqwest` —
//!    may be a direct dependency key. None of the other nine names may be a
//!    direct dependency key AT ALL, including `hyper`/`rustls`, which may
//!    exist only transitively (pulled in BY `reqwest`, never named
//!    directly in `[dependencies]`).
//! 2. **Source imports** (`check_source_imports`): scans this crate's own
//!    `.rs` files (not `Cargo.lock`, not dependencies' own source, which
//!    this crate doesn't control and isn't what "the sole outbound module"
//!    is about) for the literal path-syntax substring `"{crate}::"`.
//!    `reqwest::` must appear in exactly one file; every other name on the
//!    list must appear in zero.
//!
//! This still catches both real threats Section 12 names: a second HTTP
//! client being added (direct-dependency check), and `reqwest` being
//! silently swapped for another client library (both checks — a swap would
//! either add a new direct dependency or leave `reqwest::` absent from
//! `ai/http.rs` while a banned name's `::` shows up somewhere).

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Crate names banned as **direct** `[dependencies]` (Section 12's list
/// minus `reqwest` itself, which is required, not banned).
const BANNED_DIRECT_DEPENDENCIES: &[&str] = &[
    "ureq",
    "curl",
    "isahc",
    "surf",
    "attohttpc",
    "native-tls",
    "openssl",
    "tungstenite",
    "hyper",
    "rustls",
];

/// Crate names whose `{name}::` path syntax must appear in ZERO source
/// files (everything on Section 12's list except `reqwest`, which must
/// appear in exactly one).
const BANNED_SOURCE_IMPORTS: &[&str] = &[
    "hyper",
    "ureq",
    "curl",
    "isahc",
    "surf",
    "attohttpc",
    "rustls",
    "native_tls",
    "openssl",
    "tungstenite",
];

/// This checker's own source file legitimately contains every banned name
/// as a string literal (the lists above) — excluded from the scan it
/// performs on everything else, the same way any audit tool excludes
/// itself. Matched as a path SUFFIX relative to whatever `src_dir` a
/// caller passes in (production code always passes `<crate root>/src`, so
/// the real file's absolute path ends with this; fixture-tree tests below
/// pass an arbitrary tempdir as the stand-in `src_dir`, so the suffix is
/// deliberately independent of any specific ancestor directory name like
/// `src`). A dedicated test below (`this_checker_is_actually_excluding_the_
/// real_file_it_runs_as`) asserts this constant matches `file!()`, so the
/// exclusion can't silently stop matching after a rename.
const SELF_PATH_SUFFIX: &str = "bin/check_egress_chokepoint.rs";

#[derive(Debug, PartialEq, Eq)]
pub struct Violation(pub String);

/// Scans every `.rs` file under `src_dir` (recursively) for each
/// `{crate}::` substring. Returns, for each crate name, the sorted list of
/// relative file paths where it was found.
fn scan_source_imports(src_dir: &Path) -> BTreeMap<String, Vec<String>> {
    let mut hits: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut names_to_scan: Vec<&str> = BANNED_SOURCE_IMPORTS.to_vec();
    names_to_scan.push("reqwest");

    for path in collect_rust_files(src_dir) {
        if path
            .to_string_lossy()
            .replace('\\', "/")
            .ends_with(SELF_PATH_SUFFIX)
        {
            continue;
        }
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let relative = path
            .strip_prefix(src_dir)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        for name in &names_to_scan {
            let pattern = format!("{name}::");
            if content.contains(&pattern) {
                hits.entry((*name).to_string())
                    .or_default()
                    .push(relative.clone());
            }
        }
    }
    for paths in hits.values_mut() {
        paths.sort();
    }
    hits
}

fn collect_rust_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    collect_rust_files_into(dir, &mut out);
    out
}

fn collect_rust_files_into(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = entries.filter_map(Result::ok).collect();
    entries.sort_by_key(std::fs::DirEntry::path); // deterministic order
    for entry in entries {
        let path = entry.path();
        if path.is_dir() {
            collect_rust_files_into(&path, out);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            out.push(path);
        }
    }
}

/// Section 12 / step 2c requirement 2: source imports.
pub fn check_source_imports(src_dir: &Path) -> Result<(), Vec<Violation>> {
    let hits = scan_source_imports(src_dir);
    let mut violations = Vec::new();

    match hits.get("reqwest") {
        None => violations.push(Violation(
            "reqwest:: appears in ZERO files; expected exactly one (ai/http.rs)".to_string(),
        )),
        Some(files) if files.len() > 1 => violations.push(Violation(format!(
            "reqwest:: appears in {} files, expected exactly one: {}",
            files.len(),
            files.join(", ")
        ))),
        Some(_) => {}
    }

    for name in BANNED_SOURCE_IMPORTS {
        if let Some(files) = hits.get(*name) {
            violations.push(Violation(format!(
                "{name}:: appears in {} file(s): {}",
                files.len(),
                files.join(", ")
            )));
        }
    }

    if violations.is_empty() {
        Ok(())
    } else {
        Err(violations)
    }
}

/// Extracts the `[dependencies]` table's keys only — not `[dev-dependencies]`
/// (test-only tooling never ships and is a different guarantee entirely —
/// see `docs/DECISIONS.md`), not `[build-dependencies]`, and NOT
/// `Cargo.lock` (which would include the whole transitive tree and trip
/// the unsatisfiable-literal-reading trap this module's doc comment
/// explains). Deliberately simple line-based parsing (no `toml` crate
/// dependency) since this crate's own `Cargo.toml` is small and
/// well-formed; a key is anything before `=` or a bare table-array line,
/// on a non-comment, non-blank line between `[dependencies]` and the next
/// `[...]` section header.
fn parse_direct_dependency_keys(cargo_toml: &str) -> Vec<String> {
    let mut keys = Vec::new();
    let mut in_dependencies_section = false;
    for raw_line in cargo_toml.lines() {
        let line = raw_line.trim();
        if line.starts_with('[') {
            in_dependencies_section = line == "[dependencies]";
            continue;
        }
        if !in_dependencies_section || line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, _rest)) = line.split_once('=') {
            keys.push(key.trim().trim_matches('"').to_string());
        }
    }
    keys
}

/// Section 12 / step 2c requirement 1: direct dependencies.
pub fn check_cargo_dependencies(cargo_toml_path: &Path) -> Result<(), Vec<Violation>> {
    let content = fs::read_to_string(cargo_toml_path)
        .unwrap_or_else(|err| panic!("could not read {}: {err}", cargo_toml_path.display()));
    let keys = parse_direct_dependency_keys(&content);
    let mut violations = Vec::new();

    if !keys.iter().any(|k| k == "reqwest") {
        violations.push(Violation(
            "reqwest is not a direct [dependencies] entry; expected exactly one HTTP client"
                .to_string(),
        ));
    }
    for banned in BANNED_DIRECT_DEPENDENCIES {
        if keys.iter().any(|k| k == banned) {
            violations.push(Violation(format!("{banned} is a direct [dependencies] entry — banned (transitive-only, or entirely banned)")));
        }
    }

    if violations.is_empty() {
        Ok(())
    } else {
        Err(violations)
    }
}

fn main() {
    let root = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")));
    let src_dir = root.join("src");
    let cargo_toml = root.join("Cargo.toml");

    let mut ok = true;
    match check_source_imports(&src_dir) {
        Ok(()) => println!("OK: source-import check ({})", src_dir.display()),
        Err(violations) => {
            ok = false;
            println!("FAIL: source-import check ({})", src_dir.display());
            for v in violations {
                println!("  - {}", v.0);
            }
        }
    }
    match check_cargo_dependencies(&cargo_toml) {
        Ok(()) => println!("OK: direct-dependency check ({})", cargo_toml.display()),
        Err(violations) => {
            ok = false;
            println!("FAIL: direct-dependency check ({})", cargo_toml.display());
            for v in violations {
                println!("  - {}", v.0);
            }
        }
    }

    if !ok {
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{create_dir_all, write};

    fn write_file(dir: &Path, relative: &str, content: &str) {
        let path = dir.join(relative);
        if let Some(parent) = path.parent() {
            create_dir_all(parent).unwrap();
        }
        write(path, content).unwrap();
    }

    // -----------------------------------------------------------------
    // Source-import check — both directions, per fixture tree
    // -----------------------------------------------------------------

    #[test]
    fn source_import_check_fails_on_zero_reqwest_matches() {
        let dir = tempfile::tempdir().unwrap();
        write_file(dir.path(), "lib.rs", "pub fn nothing() {}\n");
        let result = check_source_imports(dir.path());
        let violations = result.expect_err("expected a violation for zero reqwest:: matches");
        assert!(
            violations.iter().any(|v| v.0.contains("ZERO files")),
            "{violations:?}"
        );
    }

    #[test]
    fn source_import_check_passes_on_exactly_one_reqwest_match() {
        let dir = tempfile::tempdir().unwrap();
        write_file(dir.path(), "lib.rs", "pub fn nothing() {}\n");
        write_file(
            dir.path(),
            "ai/http.rs",
            "fn f(_: reqwest::StatusCode) {}\n",
        );
        assert!(check_source_imports(dir.path()).is_ok());
    }

    #[test]
    fn source_import_check_fails_on_two_reqwest_matches() {
        let dir = tempfile::tempdir().unwrap();
        write_file(
            dir.path(),
            "ai/http.rs",
            "fn f(_: reqwest::StatusCode) {}\n",
        );
        write_file(dir.path(), "ai/other.rs", "fn g(_: reqwest::Client) {}\n");
        let result = check_source_imports(dir.path());
        let violations = result.expect_err("expected a violation for two reqwest:: matches");
        assert!(
            violations.iter().any(|v| v.0.contains("2 files")),
            "{violations:?}"
        );
    }

    #[test]
    fn source_import_check_fails_when_a_banned_crate_is_imported() {
        let dir = tempfile::tempdir().unwrap();
        write_file(
            dir.path(),
            "ai/http.rs",
            "fn f(_: reqwest::StatusCode) {}\n",
        );
        write_file(dir.path(), "ai/sneaky.rs", "fn g(_: hyper::Client) {}\n");
        let result = check_source_imports(dir.path());
        let violations = result.expect_err("expected a violation for a banned crate import");
        assert!(
            violations.iter().any(|v| v.0.starts_with("hyper::")),
            "{violations:?}"
        );
    }

    #[test]
    fn source_import_check_ignores_its_own_file() {
        // This checker's own source contains every banned name as a string
        // literal (the const lists above); prove the self-exclusion works
        // by writing a decoy at the exact excluded suffix and confirming
        // it does NOT get scanned.
        let dir = tempfile::tempdir().unwrap();
        write_file(
            dir.path(),
            "bin/check_egress_chokepoint.rs",
            "// hyper:: ureq:: curl::\n",
        );
        write_file(
            dir.path(),
            "ai/http.rs",
            "fn f(_: reqwest::StatusCode) {}\n",
        );
        assert!(check_source_imports(dir.path()).is_ok());
    }

    #[test]
    fn this_checker_is_actually_excluding_the_real_file_it_runs_as() {
        // `file!()` is relative to the crate root at compile time; assert
        // it matches the constant the runtime exclusion logic depends on,
        // so a future rename can't silently break the self-exclusion (and
        // make every run of this tool fail on itself).
        assert!(
            file!().replace('\\', "/").ends_with(SELF_PATH_SUFFIX),
            "{}",
            file!()
        );
    }

    // -----------------------------------------------------------------
    // Direct-dependency check — both directions
    // -----------------------------------------------------------------

    #[test]
    fn dependency_check_fails_when_reqwest_is_absent() {
        let dir = tempfile::tempdir().unwrap();
        let cargo_toml = dir.path().join("Cargo.toml");
        write(
            &cargo_toml,
            "[package]\nname = \"x\"\n\n[dependencies]\nserde = \"1\"\n",
        )
        .unwrap();
        let violations = check_cargo_dependencies(&cargo_toml).expect_err("expected a violation");
        assert!(
            violations
                .iter()
                .any(|v| v.0.contains("reqwest is not a direct")),
            "{violations:?}"
        );
    }

    #[test]
    fn dependency_check_passes_with_only_reqwest_as_the_http_client() {
        let dir = tempfile::tempdir().unwrap();
        let cargo_toml = dir.path().join("Cargo.toml");
        write(
            &cargo_toml,
            "[package]\nname = \"x\"\n\n[dependencies]\nserde = \"1\"\nreqwest = { version = \"0.12\" }\n",
        )
        .unwrap();
        assert!(check_cargo_dependencies(&cargo_toml).is_ok());
    }

    #[test]
    fn dependency_check_fails_on_a_planted_second_direct_http_client() {
        let dir = tempfile::tempdir().unwrap();
        let cargo_toml = dir.path().join("Cargo.toml");
        write(
            &cargo_toml,
            "[package]\nname = \"x\"\n\n[dependencies]\nreqwest = { version = \"0.12\" }\nureq = \"2\"\n",
        )
        .unwrap();
        let violations = check_cargo_dependencies(&cargo_toml).expect_err("expected a violation");
        assert!(
            violations.iter().any(|v| v.0.starts_with("ureq")),
            "{violations:?}"
        );
    }

    #[test]
    fn dependency_check_fails_when_hyper_or_rustls_is_direct_even_if_reqwest_is_present() {
        let dir = tempfile::tempdir().unwrap();
        let cargo_toml = dir.path().join("Cargo.toml");
        write(
            &cargo_toml,
            "[package]\nname = \"x\"\n\n[dependencies]\nreqwest = { version = \"0.12\" }\nhyper = \"1\"\n",
        )
        .unwrap();
        let violations = check_cargo_dependencies(&cargo_toml).expect_err("expected a violation");
        assert!(
            violations.iter().any(|v| v.0.starts_with("hyper")),
            "{violations:?}"
        );
    }

    #[test]
    fn dependency_check_ignores_dev_dependencies() {
        // Test-only tooling (e.g. a mock HTTP server crate) never ships in
        // the release binary and is a different guarantee than "the
        // product has exactly one HTTP client" — see docs/DECISIONS.md.
        let dir = tempfile::tempdir().unwrap();
        let cargo_toml = dir.path().join("Cargo.toml");
        write(
            &cargo_toml,
            "[package]\nname = \"x\"\n\n[dependencies]\nreqwest = { version = \"0.12\" }\n\n[dev-dependencies]\nhyper = \"1\"\n",
        )
        .unwrap();
        assert!(check_cargo_dependencies(&cargo_toml).is_ok());
    }

    // -----------------------------------------------------------------
    // Against the REAL crate — the actual gate
    // -----------------------------------------------------------------

    #[test]
    fn the_real_crate_passes_both_checks() {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let src_dir = manifest_dir.join("src");
        let cargo_toml = manifest_dir.join("Cargo.toml");
        assert_eq!(check_source_imports(&src_dir), Ok(()));
        assert_eq!(check_cargo_dependencies(&cargo_toml), Ok(()));
    }
}
