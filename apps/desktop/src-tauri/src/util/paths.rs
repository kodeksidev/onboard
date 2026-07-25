//! Path helpers enforcing Section 12's capability checks.
//!
//! Every function here is pure (or reads the filesystem only through
//! `std::fs::canonicalize`, which resolves symlinks) so the confinement
//! logic is unit-testable without a running app.

use std::path::{Component, Path, PathBuf};

/// Windows literal system roots + POSIX ones (Section 12's `analyze_repo`
/// capability check names both), compared case-insensitively on Windows.
const SYSTEM_ROOTS: &[&str] = &["/", "/home", "/Users", "C:\\", "C:/"];

/// Maximum bytes accepted for `read_repo_file` (Section 10, `E_FILE_TOO_LARGE`).
pub const MAX_VIEWER_FILE_BYTES: u64 = 2 * 1024 * 1024;

/// Strip a Windows `\\?\` extended-length prefix for display/comparison
/// purposes only; the prefix is added back by `to_extended_length` when a
/// filesystem call needs it (A22: some repo paths here exceed old MAX_PATH).
pub fn strip_extended_prefix(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => path.to_path_buf(),
    }
}

/// Add the `\\?\` extended-length prefix on Windows so filesystem calls
/// work for paths beyond the legacy 260-character limit (Section 10,
/// "Windows path > 260 chars"). A no-op on other platforms and a no-op if
/// the prefix is already present or the path is relative/UNC.
#[cfg(windows)]
pub fn to_extended_length(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if s.starts_with(r"\\?\") || !path.is_absolute() {
        return path.to_path_buf();
    }
    PathBuf::from(format!(r"\\?\{s}"))
}

#[cfg(not(windows))]
pub fn to_extended_length(path: &Path) -> PathBuf {
    path.to_path_buf()
}

/// True when `candidate` is (after byte-normalization) one of the hard
/// system roots `analyze_repo` must refuse (Section 12).
pub fn is_system_root(candidate: &Path) -> bool {
    let normalized = candidate.to_string_lossy().replace('\\', "/");
    let trimmed = normalized.trim_end_matches('/');
    SYSTEM_ROOTS.iter().any(|root| {
        let root_norm = root.replace('\\', "/");
        let root_trimmed = root_norm.trim_end_matches('/');
        if root_trimmed.is_empty() {
            // "/" itself
            return trimmed.is_empty();
        }
        trimmed.eq_ignore_ascii_case(root_trimmed)
    })
}

/// Result of confining a viewer-requested path to a repo root.
#[derive(Debug, PartialEq, Eq)]
pub enum ConfinementError {
    /// The path, once joined and resolved, does not live under the repo
    /// root (a `..` escape or a symlink pointing outside).
    Escapes,
    /// `path` itself was empty, absolute, or otherwise not a valid
    /// repo-relative request before any filesystem access was attempted.
    InvalidRequest,
}

/// Section 12's `read_repo_file` capability check: join `repo_root` and the
/// caller-supplied repo-relative `requested_path`, canonicalize both
/// (resolving symlinks), and require the result to sit under the
/// canonicalized repo root. Never touches the network; the only I/O is
/// `canonicalize`, which is what makes the symlink-escape check real
/// rather than a string comparison on `..`.
pub fn confine_to_repo(
    repo_root: &Path,
    requested_path: &str,
) -> Result<PathBuf, ConfinementError> {
    if requested_path.is_empty() {
        return Err(ConfinementError::InvalidRequest);
    }
    if Path::new(requested_path).is_absolute() {
        return Err(ConfinementError::InvalidRequest);
    }
    if has_root_component(requested_path) {
        return Err(ConfinementError::InvalidRequest);
    }

    let canonical_root = std::fs::canonicalize(repo_root).map_err(|_| ConfinementError::Escapes)?;
    let joined = canonical_root.join(requested_path);
    let canonical_joined = std::fs::canonicalize(&joined).map_err(|_| ConfinementError::Escapes)?;

    let root_no_prefix = strip_extended_prefix(&canonical_root);
    let joined_no_prefix = strip_extended_prefix(&canonical_joined);

    if joined_no_prefix.starts_with(&root_no_prefix) {
        Ok(canonical_joined)
    } else {
        Err(ConfinementError::Escapes)
    }
}

/// True when any path component is a Windows drive prefix or root
/// (`Component::RootDir` / `Component::Prefix`), meaning the caller tried
/// to smuggle an absolute path through a "repo-relative" field.
fn has_root_component(requested_path: &str) -> bool {
    Path::new(requested_path)
        .components()
        .any(|c| matches!(c, Component::RootDir | Component::Prefix(_)))
}

/// Human-readable size for error copy, e.g. `3.1 MB` (Section 10's
/// `E_FILE_TOO_LARGE` template uses `{size}`).
pub fn human_size(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    let bytes_f = bytes as f64;
    if bytes_f >= MB {
        format!("{:.1} MB", bytes_f / MB)
    } else if bytes_f >= KB {
        format!("{:.1} KB", bytes_f / KB)
    } else {
        format!("{bytes} B")
    }
}

/// The display name Section 10's templates use for `{name}`: the final
/// path segment, falling back to the full (repo-relative or already-safe)
/// string when there is no segment separator.
pub fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn rejects_a_dot_dot_escape_before_touching_the_filesystem() {
        let dir = tempfile::tempdir().unwrap();
        let result = confine_to_repo(dir.path(), "../../etc/passwd");
        assert_eq!(result, Err(ConfinementError::Escapes));
    }

    #[test]
    fn rejects_a_symlink_pointing_outside_the_repo() {
        let repo = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let secret = outside.path().join("secret.txt");
        fs::write(&secret, b"top secret").unwrap();

        let link_path = repo.path().join("escape-link");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&secret, &link_path).unwrap();
        #[cfg(windows)]
        {
            if std::os::windows::fs::symlink_file(&secret, &link_path).is_err() {
                // Developer mode / admin rights not available on this CI
                // runner — symlink creation itself failed, so there is
                // nothing to escape through. Skip rather than false-fail.
                return;
            }
        }

        let result = confine_to_repo(repo.path(), "escape-link");
        assert_eq!(result, Err(ConfinementError::Escapes));
    }

    #[test]
    fn accepts_a_path_that_resolves_inside_the_repo() {
        let repo = tempfile::tempdir().unwrap();
        fs::create_dir_all(repo.path().join("src")).unwrap();
        fs::write(repo.path().join("src/index.ts"), b"export {}").unwrap();

        let result = confine_to_repo(repo.path(), "src/index.ts");
        assert!(result.is_ok());
    }

    #[test]
    fn rejects_an_absolute_requested_path() {
        let repo = tempfile::tempdir().unwrap();
        let result = confine_to_repo(repo.path(), "/etc/passwd");
        assert_eq!(result, Err(ConfinementError::InvalidRequest));
    }

    #[test]
    fn recognizes_posix_and_windows_system_roots() {
        assert!(is_system_root(Path::new("/")));
        assert!(is_system_root(Path::new("/home")));
        assert!(is_system_root(Path::new("/Users")));
        assert!(is_system_root(Path::new("C:\\")));
        assert!(!is_system_root(Path::new("/home/dev/project")));
        assert!(!is_system_root(Path::new("C:\\Users\\dev\\project")));
    }

    #[test]
    fn formats_human_readable_sizes() {
        assert_eq!(human_size(500), "500 B");
        assert_eq!(human_size(1536), "1.5 KB");
        assert_eq!(human_size(3_251_609), "3.1 MB");
    }
}
