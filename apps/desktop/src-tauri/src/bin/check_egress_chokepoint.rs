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
//!
//! ## Phase 13 finding M5 — three ways this checker used to be defeatable
//!
//! The audit's question was not "is the crate clean today" (it is, and
//! `the_real_crate_passes_every_check` re-proves it on every run) but "can
//! this checker catch a future violation". It could be walked past three
//! ways, each now closed and each with a test that plants the evasion and
//! asserts the checker rejects it:
//!
//! 1. **Manifest sections it never read.** Dependency scanning switched on
//!    only for a line that was exactly `[dependencies]`, so
//!    `[dependencies.ureq]` and `[target.'cfg(windows)'.dependencies]`
//!    turned it OFF. [`scan_manifest`] now classifies every table header
//!    ([`classify_header`]) instead of comparing one string, understands
//!    the sub-table and `target` forms, and — the part that matters most —
//!    reports any header that mentions `dependencies` in a shape it does
//!    NOT recognise as a violation rather than ignoring it. A checker that
//!    silently skips what it cannot parse is the failure mode being fixed;
//!    this one fails closed on manifest syntax it has not been taught.
//! 2. **Import aliasing.** Matching the literal substring `reqwest::` missed
//!    `use reqwest as h;` — after which `h::blocking::Client::new()` names
//!    the crate nowhere. [`reference_pattern`] now also matches the `use`
//!    and `extern crate` forms, so a crate cannot be brought into a file
//!    under a different name without being seen.
//! 3. **Doors that need no crate at all.** The banned list was HTTP/TLS
//!    crates only; `std::net::TcpStream` and `std::process::Command` (which
//!    can invoke curl) were outside its scope entirely.
//!    [`check_process_and_socket_doors`] adds them, against an explicit
//!    allowlist of the doors that exist today and have been reviewed
//!    ([`REVIEWED_DOORS`]). The allowlist is deliberately per-file AND
//!    per-symbol, and `every_reviewed_door_still_exists_in_the_real_crate`
//!    fails if an entry stops matching anything — so it cannot quietly
//!    accumulate permissions for code that no longer exists.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use regex::Regex;

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

/// Section 12's threat model names "a stray HTTP client", but an outbound
/// door needs no crate: a raw socket, or a subprocess invoking `curl`, is
/// the same hole. These substrings are the primitives that can open one.
/// Each is written with its `::` so a doc comment mentioning `TcpListener`
/// or `std::process` in prose is not mistaken for a use of it.
const PROCESS_AND_SOCKET_DOORS: &[&str] = &[
    "std::net::",
    "TcpStream::",
    "TcpListener::",
    "UdpSocket::",
    "std::process::Command",
    "Command::new",
];

/// The doors that exist today, each reviewed and each justified below.
/// Anything not on this list is a violation — this is an allowlist, not a
/// denylist, which is what makes a NEW door impossible to add unnoticed.
///
/// - `sidecar/spawn.rs` is the one place the engine subprocess is started
///   (Section 5's sidecar supervision); it is the only legitimate
///   process-spawn site in the crate.
/// - The four `TcpListener` entries are local, ephemeral test servers
///   inside `#[cfg(test)]` modules, used to point an AI adapter at
///   `127.0.0.1` and assert the real bytes it sends. They are how the
///   egress guarantees are proven, not a way around them.
const REVIEWED_DOORS: &[(&str, &str)] = &[
    // `spawn.rs` imports `Command` by name (`use std::process::{Child,
    // Command, Stdio}`) rather than writing `std::process::Command`, so
    // `Command::new` is the entry that actually covers it — as
    // `every_reviewed_door_still_exists_in_the_real_crate` insists.
    ("sidecar/spawn.rs", "Command::new"),
    ("ai/anthropic.rs", "std::net::"),
    ("ai/anthropic.rs", "TcpListener::"),
    ("ai/ollama.rs", "std::net::"),
    ("ai/ollama.rs", "TcpListener::"),
    ("commands/ai.rs", "std::net::"),
    ("commands/ai.rs", "TcpListener::"),
];

#[derive(Debug, PartialEq, Eq)]
pub struct Violation(pub String);

/// Every way a crate can be named in Rust source: as a path prefix
/// (`reqwest::Client`), as an import that may be renamed on the spot
/// (`use reqwest as h;` — M5's evasion 2), or as a 2015-edition
/// `extern crate`. Built once per crate name, not once per file.
fn reference_pattern(name: &str) -> Regex {
    let escaped = regex::escape(name);
    Regex::new(&format!(
        r"\b{escaped}\s*::|\buse\s+(?:::\s*)?{escaped}\s*(?:;|::|\{{|as\b)|\bextern\s+crate\s+{escaped}\b"
    ))
    .expect("reference pattern must compile")
}

/// Reads every `.rs` file under `src_dir` (recursively, deterministically),
/// skipping this checker's own source. Yields `(relative path, contents)`.
fn read_scannable_sources(src_dir: &Path) -> Vec<(String, String)> {
    collect_rust_files(src_dir)
        .into_iter()
        .filter(|path| {
            !path
                .to_string_lossy()
                .replace('\\', "/")
                .ends_with(SELF_PATH_SUFFIX)
        })
        .filter_map(|path| {
            let content = fs::read_to_string(&path).ok()?;
            let relative = path
                .strip_prefix(src_dir)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            Some((relative, content))
        })
        .collect()
}

/// Scans every `.rs` file under `src_dir` for each crate name in any of the
/// forms [`reference_pattern`] recognises. Returns, for each crate name,
/// the sorted list of relative file paths where it was found.
fn scan_source_imports(src_dir: &Path) -> BTreeMap<String, Vec<String>> {
    let mut names_to_scan: Vec<&str> = BANNED_SOURCE_IMPORTS.to_vec();
    names_to_scan.push("reqwest");
    let patterns: Vec<(&str, Regex)> = names_to_scan
        .iter()
        .map(|name| (*name, reference_pattern(name)))
        .collect();

    let mut hits: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (relative, content) in read_scannable_sources(src_dir) {
        for (name, pattern) in &patterns {
            if pattern.is_match(&content) {
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

/// M5's evasion 3: a socket or subprocess is an outbound door that no
/// dependency check can see. Every occurrence outside [`REVIEWED_DOORS`]
/// is a violation.
pub fn check_process_and_socket_doors(src_dir: &Path) -> Result<(), Vec<Violation>> {
    let mut violations = Vec::new();
    for (relative, content) in read_scannable_sources(src_dir) {
        for door in PROCESS_AND_SOCKET_DOORS {
            if !content.contains(door) {
                continue;
            }
            if REVIEWED_DOORS.contains(&(relative.as_str(), door)) {
                continue;
            }
            violations.push(Violation(format!(
                "{door} appears in {relative}, which is not a reviewed process/socket door"
            )));
        }
    }
    if violations.is_empty() {
        Ok(())
    } else {
        Err(violations)
    }
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

/// What one `[...]` table header means for dependency scanning.
#[derive(Debug, PartialEq, Eq)]
enum HeaderKind {
    /// A table whose KEYS are dependency names (`[dependencies]`,
    /// `[target.'cfg(windows)'.dependencies]`).
    DependencyTable,
    /// A table that IS one dependency (`[dependencies.ureq]`); its keys are
    /// that dependency's own fields and must not be read as crate names.
    DependencyEntry(String),
    /// Nothing to do with shipped dependencies — `[package]`, `[lib]`,
    /// `[dev-dependencies]`, `[build-dependencies]`, `[profile.release]`.
    OutOfScope,
    /// Mentions `dependencies` in a shape this parser does not know. Fails
    /// closed: reported as a violation rather than skipped, because
    /// "silently skipped what it could not parse" is exactly the defect M5
    /// found.
    Unrecognised,
}

/// Splits a header's inner text on `.`, honouring quoted segments so
/// `target."cfg(target_os = \"macos\")".dependencies` yields three parts
/// rather than being shredded by the dots inside the cfg expression.
fn split_header_segments(inner: &str) -> Vec<String> {
    let mut segments = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    for c in inner.chars() {
        match (quote, c) {
            (Some(open), c) if c == open => quote = None,
            (Some(_), c) => current.push(c),
            (None, '"' | '\'') => quote = Some(c),
            (None, '.') => segments.push(std::mem::take(&mut current).trim().to_string()),
            (None, c) => current.push(c),
        }
    }
    segments.push(current.trim().to_string());
    segments
}

fn classify_header(header_line: &str) -> HeaderKind {
    let inner = header_line.trim_start_matches('[').trim_end_matches(']');
    let segments = split_header_segments(inner);
    // A `[target.<cfg>.…]` header is the same table as the one it wraps,
    // just platform-conditional — M5's evasion 1b.
    let rest = if segments.first().map(String::as_str) == Some("target") && segments.len() > 2 {
        &segments[2..]
    } else {
        &segments[..]
    };
    match rest {
        [head] if head == "dependencies" => HeaderKind::DependencyTable,
        [head, name] if head == "dependencies" => HeaderKind::DependencyEntry(name.clone()),
        // Test-only and build-only tooling never ships: a different
        // guarantee entirely (see `docs/DECISIONS.md`).
        [head, ..] if head == "dev-dependencies" || head == "build-dependencies" => {
            HeaderKind::OutOfScope
        }
        _ if rest.iter().any(|s| s.ends_with("dependencies")) => HeaderKind::Unrecognised,
        _ => HeaderKind::OutOfScope,
    }
}

/// What [`scan_manifest`] found: every direct dependency key, plus any
/// header it could not classify.
struct ManifestScan {
    keys: Vec<String>,
    unrecognised_headers: Vec<String>,
}

/// Extracts direct dependency names — not `[dev-dependencies]`, not
/// `[build-dependencies]`, and NOT `Cargo.lock` (which would include the
/// whole transitive tree and trip the unsatisfiable-literal-reading trap
/// this module's doc comment explains). Deliberately line-based (no `toml`
/// crate dependency) since this crate's own manifest is small and
/// well-formed, but header classification is now structural rather than a
/// single string comparison — see [`classify_header`] and M5's evasion 1.
fn scan_manifest(cargo_toml: &str) -> ManifestScan {
    let mut scan = ManifestScan {
        keys: Vec::new(),
        unrecognised_headers: Vec::new(),
    };
    let mut reading_keys = false;
    for raw_line in cargo_toml.lines() {
        let line = raw_line.trim();
        if line.starts_with('[') {
            reading_keys = false;
            match classify_header(line) {
                HeaderKind::DependencyTable => reading_keys = true,
                HeaderKind::DependencyEntry(name) => scan.keys.push(name),
                HeaderKind::Unrecognised => scan.unrecognised_headers.push(line.to_string()),
                HeaderKind::OutOfScope => {}
            }
            continue;
        }
        if !reading_keys || line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, _rest)) = line.split_once('=') {
            scan.keys.push(key.trim().trim_matches('"').to_string());
        }
    }
    scan
}

/// Section 12 / step 2c requirement 1: direct dependencies.
pub fn check_cargo_dependencies(cargo_toml_path: &Path) -> Result<(), Vec<Violation>> {
    let content = fs::read_to_string(cargo_toml_path)
        .unwrap_or_else(|err| panic!("could not read {}: {err}", cargo_toml_path.display()));
    let ManifestScan {
        keys,
        unrecognised_headers,
    } = scan_manifest(&content);
    let mut violations = Vec::new();

    for header in unrecognised_headers {
        violations.push(Violation(format!(
            "{header} is a dependency table this checker does not understand — it cannot be scanned, so it is refused"
        )));
    }
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

/// Prints one check's verdict and reports whether it passed.
fn report(label: &str, subject: &Path, outcome: Result<(), Vec<Violation>>) -> bool {
    match outcome {
        Ok(()) => {
            println!("OK: {label} ({})", subject.display());
            true
        }
        Err(violations) => {
            println!("FAIL: {label} ({})", subject.display());
            for v in violations {
                println!("  - {}", v.0);
            }
            false
        }
    }
}

fn main() {
    let root = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")));
    let src_dir = root.join("src");
    let cargo_toml = root.join("Cargo.toml");

    let checks = [
        report(
            "source-import check",
            &src_dir,
            check_source_imports(&src_dir),
        ),
        report(
            "direct-dependency check",
            &cargo_toml,
            check_cargo_dependencies(&cargo_toml),
        ),
        report(
            "process/socket door check",
            &src_dir,
            check_process_and_socket_doors(&src_dir),
        ),
    ];

    if !checks.iter().all(|passed| *passed) {
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
    // Phase 13 M5 — each of the three evasions, planted and refused
    // -----------------------------------------------------------------

    fn manifest(body: &str) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path().join("Cargo.toml"), body).unwrap();
        dir
    }

    fn dependency_violations(body: &str) -> Vec<Violation> {
        let dir = manifest(body);
        check_cargo_dependencies(&dir.path().join("Cargo.toml")).expect_err("expected a violation")
    }

    /// Evasion 1a: a sub-table header used to turn scanning OFF, so the
    /// crate it names was never seen at all.
    #[test]
    fn dependency_check_fails_on_a_second_client_declared_as_a_sub_table() {
        let violations = dependency_violations(
            "[package]\nname = \"x\"\n\n[dependencies]\nreqwest = \"0.12\"\n\n[dependencies.ureq]\nversion = \"2\"\n",
        );
        assert!(
            violations.iter().any(|v| v.0.starts_with("ureq")),
            "{violations:?}"
        );
    }

    /// Evasion 1b: the same, hidden behind a platform predicate. The cfg
    /// expression contains quotes and parentheses, which is what the
    /// quote-aware segment splitter is for.
    #[test]
    fn dependency_check_fails_on_a_platform_conditional_second_client() {
        let violations = dependency_violations(
            "[package]\nname = \"x\"\n\n[dependencies]\nreqwest = \"0.12\"\n\n[target.'cfg(windows)'.dependencies]\nureq = \"2\"\n",
        );
        assert!(
            violations.iter().any(|v| v.0.starts_with("ureq")),
            "{violations:?}"
        );

        let both = dependency_violations(
            "[package]\nname = \"x\"\n\n[dependencies]\nreqwest = \"0.12\"\n\n[target.\"cfg(target_os = \\\"macos\\\")\".dependencies.curl]\nversion = \"0.4\"\n",
        );
        assert!(both.iter().any(|v| v.0.starts_with("curl")), "{both:?}");
    }

    /// A dependency key can also arrive through a form this parser has not
    /// been taught. It must be refused, not skipped — the whole defect
    /// being fixed was a scanner that ignored what it did not recognise.
    #[test]
    fn dependency_check_refuses_a_dependency_table_it_cannot_classify() {
        let violations = dependency_violations(
            "[package]\nname = \"x\"\n\n[dependencies]\nreqwest = \"0.12\"\n\n[workspace.dependencies]\nureq = \"2\"\n",
        );
        assert!(
            violations
                .iter()
                .any(|v| v.0.contains("does not understand")),
            "{violations:?}"
        );
    }

    /// The dev-dependency exemption survives the new classifier, including
    /// in its platform-conditional and sub-table spellings.
    #[test]
    fn dependency_check_still_ignores_dev_dependencies_in_every_spelling() {
        for body in [
            "[package]\nname = \"x\"\n\n[dependencies]\nreqwest = \"0.12\"\n\n[target.'cfg(unix)'.dev-dependencies]\nhyper = \"1\"\n",
            "[package]\nname = \"x\"\n\n[dependencies]\nreqwest = \"0.12\"\n\n[dev-dependencies.hyper]\nversion = \"1\"\n",
            "[package]\nname = \"x\"\n\n[dependencies]\nreqwest = \"0.12\"\n\n[build-dependencies]\nhyper = \"1\"\n",
        ] {
            let dir = manifest(body);
            assert_eq!(
                check_cargo_dependencies(&dir.path().join("Cargo.toml")),
                Ok(()),
                "{body}"
            );
        }
    }

    /// Evasion 2: `use reqwest as h;` names the crate once and never again,
    /// so the old literal `reqwest::` substring match saw nothing.
    #[test]
    fn source_import_check_catches_an_aliased_second_reqwest_consumer() {
        let dir = tempfile::tempdir().unwrap();
        write_file(
            dir.path(),
            "ai/http.rs",
            "fn f(_: reqwest::StatusCode) {}\n",
        );
        write_file(
            dir.path(),
            "ai/sneaky.rs",
            "use reqwest as h;\nfn g() { let _ = h::blocking::Client::new(); }\n",
        );
        let violations = check_source_imports(dir.path()).expect_err("expected a violation");
        assert!(
            violations.iter().any(|v| v.0.contains("2 files")),
            "{violations:?}"
        );
    }

    #[test]
    fn source_import_check_catches_an_aliased_banned_crate() {
        let dir = tempfile::tempdir().unwrap();
        write_file(
            dir.path(),
            "ai/http.rs",
            "fn f(_: reqwest::StatusCode) {}\n",
        );
        write_file(dir.path(), "ai/sneaky.rs", "use ureq as u;\n");
        let violations = check_source_imports(dir.path()).expect_err("expected a violation");
        assert!(
            violations.iter().any(|v| v.0.starts_with("ureq::")),
            "{violations:?}"
        );
    }

    /// Evasion 3: a door that needs no dependency at all.
    #[test]
    fn door_check_fails_on_a_planted_socket_or_subprocess() {
        for (relative, source) in [
            ("ai/sneaky.rs", "use std::net::TcpStream;\n"),
            (
                "ai/sneaky.rs",
                "fn g() { let _ = TcpStream::connect(\"x\"); }\n",
            ),
            (
                "commands/sneaky.rs",
                "fn g() { std::process::Command::new(\"curl\"); }\n",
            ),
            ("util/sneaky.rs", "fn g() { Command::new(\"curl\"); }\n"),
        ] {
            let dir = tempfile::tempdir().unwrap();
            write_file(dir.path(), relative, source);
            let violations =
                check_process_and_socket_doors(dir.path()).expect_err("expected a violation");
            assert!(
                violations.iter().any(|v| v.0.contains(relative)),
                "{source}: {violations:?}"
            );
        }
    }

    /// ...and passes for the reviewed doors, matched per-file AND
    /// per-symbol: the same primitive in a different file is still refused.
    #[test]
    fn door_check_allows_only_the_reviewed_file_for_a_reviewed_symbol() {
        let dir = tempfile::tempdir().unwrap();
        write_file(
            dir.path(),
            "sidecar/spawn.rs",
            "use std::process::{Child, Command, Stdio};\nfn s() { Command::new(\"x\"); }\n",
        );
        assert_eq!(check_process_and_socket_doors(dir.path()), Ok(()));

        write_file(
            dir.path(),
            "sidecar/other.rs",
            "fn s() { Command::new(\"x\"); }\n",
        );
        let violations =
            check_process_and_socket_doors(dir.path()).expect_err("expected a violation");
        assert!(
            violations.iter().any(|v| v.0.contains("sidecar/other.rs")),
            "{violations:?}"
        );
    }

    /// An allowlist that outlives the code it excuses is a standing grant
    /// nobody is looking at. Every entry must still match something real.
    #[test]
    fn every_reviewed_door_still_exists_in_the_real_crate() {
        let src_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
        let sources = read_scannable_sources(&src_dir);
        for (relative, door) in REVIEWED_DOORS {
            let found = sources
                .iter()
                .any(|(path, content)| path == relative && content.contains(door));
            assert!(
                found,
                "REVIEWED_DOORS entry ({relative}, {door}) matches nothing — remove it"
            );
        }
    }

    // -----------------------------------------------------------------
    // Against the REAL crate — the actual gate
    // -----------------------------------------------------------------

    #[test]
    fn the_real_crate_passes_every_check() {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let src_dir = manifest_dir.join("src");
        let cargo_toml = manifest_dir.join("Cargo.toml");
        assert_eq!(check_source_imports(&src_dir), Ok(()));
        assert_eq!(check_cargo_dependencies(&cargo_toml), Ok(()));
        assert_eq!(check_process_and_socket_doors(&src_dir), Ok(()));
    }
}
