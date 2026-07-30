//! `read_repo_file` (Section 7.4). Confinement, size cap, and language
//! detection all happen in Rust — no round trip to the sidecar (the file
//! viewer must keep working even while an analysis is in flight or the
//! sidecar is down).

use once_cell::sync::Lazy;
use regex::Regex;

use crate::constants::PATH_ARG_MAX_BYTES;
use crate::contract::{FileContent, Language};
use crate::error::AppError;
use crate::state::AppState;
use crate::util::paths::{
    confine_to_repo, display_name, human_size, ConfinementError, MAX_VIEWER_FILE_BYTES,
};

static REPO_ID_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new("^[0-9a-f]{16}$").expect("valid regex"));

/// Counts lines the way editors do: a trailing `\n` does not add a phantom
/// empty final line, but content without one still counts as one line.
fn count_lines(content: &str) -> u64 {
    if content.is_empty() {
        return 0;
    }
    let newline_count = content.matches('\n').count() as u64;
    if content.ends_with('\n') {
        newline_count
    } else {
        newline_count + 1
    }
}

fn language_for_extension(path: &str) -> Language {
    match path
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "ts" => Language::Ts,
        "tsx" => Language::Tsx,
        "js" | "mjs" | "cjs" => Language::Js,
        "jsx" => Language::Jsx,
        "py" => Language::Py,
        "json" => Language::Json,
        "md" | "mdx" => Language::Md,
        _ => Language::Other,
    }
}

pub fn read_repo_file_core(
    state: &AppState,
    repo_id: String,
    path: String,
) -> Result<FileContent, AppError> {
    if !REPO_ID_PATTERN.is_match(&repo_id) {
        return Err(AppError::path_escapes_repo(&path));
    }
    if path.is_empty() || path.len() > PATH_ARG_MAX_BYTES {
        return Err(AppError::path_escapes_repo(&path));
    }

    let repo_root = state
        .repo_root_for(&repo_id)
        .ok_or_else(|| AppError::path_escapes_repo(&path))?;

    let resolved = confine_to_repo(&repo_root, &path).map_err(|err| match err {
        ConfinementError::Escapes | ConfinementError::InvalidRequest => {
            AppError::path_escapes_repo(&path)
        }
    })?;

    let metadata = std::fs::metadata(&resolved).map_err(|io_err| {
        if io_err.kind() == std::io::ErrorKind::PermissionDenied {
            AppError::permission_denied(&display_name(&resolved))
        } else {
            AppError::path_escapes_repo(&path)
        }
    })?;

    if metadata.len() > MAX_VIEWER_FILE_BYTES {
        return Err(AppError::file_too_large(
            &display_name(&resolved),
            &human_size(metadata.len()),
        ));
    }

    let bytes = std::fs::read(&resolved)
        .map_err(|_| AppError::permission_denied(&display_name(&resolved)))?;
    let content = String::from_utf8_lossy(&bytes).into_owned();
    let line_count = count_lines(&content);

    Ok(FileContent {
        path,
        language: language_for_extension(&resolved.to_string_lossy()),
        line_count,
        is_truncated: false,
        content,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sidecar::supervisor::{SidecarConfig, SidecarSupervisor};
    use crate::state::AppState;
    use std::collections::HashMap;
    use std::sync::Mutex;

    fn test_state_with_repo(repo_root: &std::path::Path) -> (AppState, String) {
        // `read_repo_file_core` never touches the sidecar, so no real
        // spawnable program is needed here (unlike `tests/analyze_repo.rs`
        // and `tests/search_repo.rs`).
        let config = SidecarConfig {
            program: Some(std::path::PathBuf::from(
                "unused-read-file-never-calls-the-sidecar",
            )),
            args: vec![],
            log_path: "C:/fake/onboard.log".to_string(),
            max_restarts: 3,
        };
        let temp_log = tempfile::tempdir().unwrap();
        let state = AppState {
            supervisor: SidecarSupervisor::new(config),
            sessions: Mutex::new(HashMap::new()),
            ai_keys: crate::secrets::ai_key::AiKeyStore::new(),
            ai_rate_limiter: crate::ai::rate_limit::AiRateLimiter::new(),
            logger: crate::util::logging::RotatingLogger::open(
                &temp_log.path().join("onboard.log"),
            )
            .unwrap(),
        };
        let repo_id = "0123456789abcdef".to_string();
        state.record_session(repo_id.clone(), repo_root.to_path_buf());
        (state, repo_id)
    }

    #[test]
    fn rejects_a_dot_dot_escape() {
        let repo = tempfile::tempdir().unwrap();
        let (state, repo_id) = test_state_with_repo(repo.path());

        let result = read_repo_file_core(&state, repo_id, "../../etc/passwd".to_string());
        assert_eq!(result.unwrap_err().code, "E_PATH_ESCAPES_REPO");
    }

    #[test]
    fn rejects_a_symlink_pointing_outside_the_repo() {
        let repo = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let secret = outside.path().join("secret.txt");
        std::fs::write(&secret, b"top secret").unwrap();
        let link_path = repo.path().join("escape-link");

        #[cfg(unix)]
        std::os::unix::fs::symlink(&secret, &link_path).unwrap();
        #[cfg(windows)]
        {
            if std::os::windows::fs::symlink_file(&secret, &link_path).is_err() {
                return; // no dev-mode/admin rights on this runner
            }
        }

        let (state, repo_id) = test_state_with_repo(repo.path());
        let result = read_repo_file_core(&state, repo_id, "escape-link".to_string());
        assert_eq!(result.unwrap_err().code, "E_PATH_ESCAPES_REPO");
    }

    #[test]
    fn reads_a_file_inside_the_repo_successfully() {
        let repo = tempfile::tempdir().unwrap();
        std::fs::write(repo.path().join("index.ts"), b"export const a = 1;\n").unwrap();
        let (state, repo_id) = test_state_with_repo(repo.path());

        let result = read_repo_file_core(&state, repo_id, "index.ts".to_string()).unwrap();
        assert_eq!(result.content, "export const a = 1;\n");
        assert!(matches!(result.language, Language::Ts));
        assert_eq!(result.line_count, 1);
    }

    #[test]
    fn rejects_a_file_over_two_megabytes() {
        let repo = tempfile::tempdir().unwrap();
        let big_path = repo.path().join("big.log");
        let file = std::fs::File::create(&big_path).unwrap();
        file.set_len(MAX_VIEWER_FILE_BYTES + 1).unwrap();
        let (state, repo_id) = test_state_with_repo(repo.path());

        let result = read_repo_file_core(&state, repo_id, "big.log".to_string());
        assert_eq!(result.unwrap_err().code, "E_FILE_TOO_LARGE");
    }

    #[test]
    fn an_unknown_repo_id_is_treated_as_a_path_escape() {
        let repo = tempfile::tempdir().unwrap();
        let (state, _repo_id) = test_state_with_repo(repo.path());

        let result = read_repo_file_core(
            &state,
            "ffffffffffffffff".to_string(),
            "index.ts".to_string(),
        );
        assert_eq!(result.unwrap_err().code, "E_PATH_ESCAPES_REPO");
    }
}
