//! Fails if a credential-shaped literal appears anywhere in the workspace.
//!
//! Sibling to `packages/contract/test/line-framing.guard.test.ts`, and here
//! for the same reason: a rule that lives only in a reviewer's head gets
//! broken by the next person who has not read the module comment.
//! `privacy::fake_secrets` assembles every such string from fragments so
//! that GitHub push protection has nothing to match; this test is what stops
//! a new call site quietly reintroducing a literal.
//!
//! ## Why `fake_secrets.rs` itself needs no allowance
//!
//! Because it contains no contiguous credential-shaped literal either — that
//! is the entire point of assembling from fragments. An allowance for it
//! would be dead weight that also weakened the guard, since a future literal
//! added there would be excused. The only allowed path is THIS file, which
//! necessarily spells the patterns out in order to search for them.
//!
//! ## Derived, not enumerated
//!
//! The file set comes from the root `package.json`'s `workspaces` globs plus
//! `docs/`, not from a hand-written list of directories. A package added
//! later is covered by construction. Same standard as the Section 14 tree
//! parser and the line-framing guard — a check whose scope is asserted
//! rather than derived is the defect this project keeps rediscovering.

use std::fs;
use std::path::{Path, PathBuf};

use regex::Regex;

/// Paths allowed to contain a credential-shaped literal, by EXACT relative
/// path — never by filename pattern or directory prefix. A pattern such as
/// "any file ending in _guard.rs" would excuse a file that merely renamed
/// itself into the allowance.
const ALLOWED: &[&str] = &["apps/desktop/src-tauri/tests/fake_secrets_guard.rs"];

/// Extensions worth scanning: source, and prose that could quote a secret.
const SCANNED_EXTENSIONS: &[&str] = &["rs", "ts", "tsx", "js", "json", "md", "toml"];

const IGNORED_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    ".git",
    "coverage",
    "__snapshots__",
    "grammars",
    "binaries",
];

fn repo_root() -> PathBuf {
    // <repo>/apps/desktop/src-tauri
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .expect("manifest dir should be three levels below the repo root")
        .to_path_buf()
}

/// The eight scanner-relevant families, spelled as patterns rather than as
/// example values so this file's own text stays unmatched by real scanners
/// wherever possible.
fn credential_patterns() -> Vec<(&'static str, Regex)> {
    let raw: &[(&str, &str)] = &[
        ("aws", r"AKIA[A-Z0-9]{16}"),
        ("github", r"gh[ps]_[A-Za-z0-9]{20,}"),
        ("slack", r"xox[abp]-[A-Za-z0-9-]{10,}"),
        ("stripe", r"(?:sk|rk|pk)_live_[A-Za-z0-9]{10,}"),
        ("google", r"AIzaSy[A-Za-z0-9_\-]{20,}"),
        ("anthropic", r"sk-ant-[A-Za-z0-9]{10,}"),
        ("openai", r"sk-[A-Za-z0-9]{20,}"),
        ("jwt", r"eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}"),
    ];
    raw.iter()
        .map(|(name, pattern)| (*name, Regex::new(pattern).expect("pattern must compile")))
        .collect()
}

/// Workspace source roots, derived from the root manifest's `workspaces`
/// globs rather than hand-listed.
fn scanned_roots(root: &Path) -> Vec<PathBuf> {
    let manifest = fs::read_to_string(root.join("package.json")).expect("root package.json");
    let value: serde_json::Value = serde_json::from_str(&manifest).expect("valid package.json");
    let globs = value["workspaces"]
        .as_array()
        .expect("package.json must declare workspaces");

    let mut roots = Vec::new();
    for glob in globs {
        let glob = glob.as_str().expect("workspace glob must be a string");
        assert!(
            glob.ends_with("/*"),
            "unsupported workspace glob {glob:?}: this guard understands only \"<dir>/*\". \
             Update scanned_roots rather than letting the scan silently shrink."
        );
        let parent = root.join(glob.trim_end_matches("/*"));
        for entry in fs::read_dir(&parent).expect("workspace parent must exist") {
            let path = entry.expect("readable entry").path();
            if path.is_dir() {
                roots.push(path);
            }
        }
    }
    // Prose can quote a secret too; `docs/` is not a workspace package.
    roots.push(root.join("docs"));
    roots
}

fn collect_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if IGNORED_DIRS.contains(&name.as_ref()) {
            continue;
        }
        if path.is_dir() {
            collect_files(&path, out);
            continue;
        }
        let matches_extension = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| SCANNED_EXTENSIONS.contains(&e));
        if matches_extension {
            out.push(path);
        }
    }
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

#[test]
fn no_credential_shaped_literal_exists_outside_fake_secrets() {
    let root = repo_root();
    let patterns = credential_patterns();
    let mut files = Vec::new();
    for scanned in scanned_roots(&root) {
        collect_files(&scanned, &mut files);
    }

    let mut offenders: Vec<String> = Vec::new();
    for file in &files {
        let rel = relative(&root, file);
        if ALLOWED.contains(&rel.as_str()) {
            continue;
        }
        let Ok(text) = fs::read_to_string(file) else {
            continue;
        };
        for (family, pattern) in &patterns {
            if let Some(hit) = pattern.find(&text) {
                offenders.push(format!("{rel}: {family} literal {:?}", hit.as_str()));
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "credential-shaped literals must be assembled in privacy::fake_secrets, not written \
         inline — GitHub push protection matches shape, not secrecy:\n{}",
        offenders.join("\n")
    );
}

/// Non-vacuity, part one: the scan must actually reach files. A broken
/// walker or a typo'd root would otherwise make the assertion above
/// permanently, silently green.
#[test]
fn the_scan_visits_a_meaningful_number_of_files() {
    let root = repo_root();
    let mut files = Vec::new();
    for scanned in scanned_roots(&root) {
        collect_files(&scanned, &mut files);
    }
    assert!(
        files.len() > 100,
        "guard scanned only {} files — the walk is probably broken",
        files.len()
    );
    // The file the guard exists to protect must be among them.
    let expected = "apps/desktop/src-tauri/src/privacy/fake_secrets.rs";
    assert!(
        files.iter().any(|f| relative(&root, f) == expected),
        "guard did not reach {expected}"
    );
}

/// Non-vacuity, part two: an allowance that no longer resolves must FAIL
/// rather than sit inert. Otherwise renaming an allowed file silently widens
/// the allowance to nothing — the guard would keep passing while excusing a
/// path that does not exist, and the real file would be unprotected.
#[test]
fn every_allowed_path_still_exists() {
    let root = repo_root();
    for allowed in ALLOWED {
        assert!(
            root.join(allowed).is_file(),
            "allowed path {allowed} does not exist. An allowance for a missing file is dead \
             weight that hides a rename — delete it or correct it."
        );
    }
}

/// Non-vacuity, part three: the patterns must match the shapes they name.
#[test]
fn the_patterns_detect_the_shapes_they_are_written_for() {
    let patterns = credential_patterns();
    let samples: &[(&str, String)] = &[
        ("aws", format!("{}{}", "AKIA", "IOSFODNN7EXAMPLE")),
        (
            "stripe",
            format!("{}{}{}", "sk", "_live_", "abcdefghijklmnop12"),
        ),
        (
            "anthropic",
            format!("{}{}{}", "sk-", "ant-", "abcdefghijklmnop"),
        ),
    ];
    for (family, sample) in samples {
        let (_, pattern) = patterns
            .iter()
            .find(|(n, _)| n == family)
            .unwrap_or_else(|| panic!("no pattern named {family}"));
        assert!(
            pattern.is_match(sample),
            "pattern {family} does not match the shape it is written for"
        );
    }
    // And must not fire on ordinary prose.
    for (family, pattern) in &patterns {
        assert!(
            !pattern.is_match("this is an ordinary sentence about keys and tokens"),
            "pattern {family} matches ordinary prose"
        );
    }
}
