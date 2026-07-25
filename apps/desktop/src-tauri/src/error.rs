//! `AppError` — the error envelope shared verbatim with the TS contract
//! (Section 7, closing block; `packages/contract/src/error.ts`).
//!
//! `message` is ALWAYS drawn from the literal copy table in Section 10 (or,
//! where Section 10 defines no literal copy for a code, from the single
//! conventional string chosen and logged in `docs/DECISIONS.md`). Raw OS
//! errors, provider bodies, and stack traces are only ever placed in
//! `detail`, never in `message`.

use serde::{Deserialize, Serialize};

/// The closed set of `E_*` codes this crate can produce. Transcribed from
/// `packages/contract/src/error.ts`'s `AppErrorCode`, restricted to the
/// codes Phase 6 owns (everything except the `ai_*` family, which is
/// Phase 12's `E_AI_*` codes).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AppErrorCode {
    EEngineVersionMismatch,
    EPathNotFound,
    ENotADirectory,
    EPermissionDenied,
    ENoSupportedFiles,
    ERepoTooLarge,
    EEngineCrashed,
    EEngineTimeout,
    EAnalysisInProgress,
    ENoAnalysis,
    EFileTooLarge,
    EPathEscapesRepo,
    EInvalidSettings,
    EKeychainUnavailable,
}

impl AppErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            AppErrorCode::EEngineVersionMismatch => "E_ENGINE_VERSION_MISMATCH",
            AppErrorCode::EPathNotFound => "E_PATH_NOT_FOUND",
            AppErrorCode::ENotADirectory => "E_NOT_A_DIRECTORY",
            AppErrorCode::EPermissionDenied => "E_PERMISSION_DENIED",
            AppErrorCode::ENoSupportedFiles => "E_NO_SUPPORTED_FILES",
            AppErrorCode::ERepoTooLarge => "E_REPO_TOO_LARGE",
            AppErrorCode::EEngineCrashed => "E_ENGINE_CRASHED",
            AppErrorCode::EEngineTimeout => "E_ENGINE_TIMEOUT",
            AppErrorCode::EAnalysisInProgress => "E_ANALYSIS_IN_PROGRESS",
            AppErrorCode::ENoAnalysis => "E_NO_ANALYSIS",
            AppErrorCode::EFileTooLarge => "E_FILE_TOO_LARGE",
            AppErrorCode::EPathEscapesRepo => "E_PATH_ESCAPES_REPO",
            AppErrorCode::EInvalidSettings => "E_INVALID_SETTINGS",
            AppErrorCode::EKeychainUnavailable => "E_KEYCHAIN_UNAVAILABLE",
        }
    }

    /// The literal, user-facing `message` for this code (Section 10's copy
    /// table verbatim where one exists).
    fn message(self) -> &'static str {
        match self {
            AppErrorCode::EEngineVersionMismatch => "The analysis engine version doesn't match",
            AppErrorCode::EPathNotFound => "That folder no longer exists",
            AppErrorCode::ENotADirectory => "That folder can't be analyzed",
            AppErrorCode::EPermissionDenied => "Onboard can't read this folder",
            AppErrorCode::ENoSupportedFiles => "No supported source files found",
            AppErrorCode::ERepoTooLarge => "This repository is too large to map in one pass",
            AppErrorCode::EEngineCrashed => "Analysis stopped unexpectedly",
            AppErrorCode::EEngineTimeout => "Analysis is taking too long",
            AppErrorCode::EAnalysisInProgress => "An analysis is already running",
            AppErrorCode::ENoAnalysis => "This repository hasn't been analyzed yet",
            AppErrorCode::EFileTooLarge => "File too large to display",
            AppErrorCode::EPathEscapesRepo => "That file is outside the repository",
            AppErrorCode::EInvalidSettings => "Those settings couldn't be saved",
            AppErrorCode::EKeychainUnavailable => "No system keyring available",
        }
    }
}

/// `AppError` — identical shape to the TS `AppError` (Rust ⇄ TS wire type).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub detail: Option<String>,
    pub path: Option<String>,
}

impl AppError {
    pub fn new(code: AppErrorCode, detail: impl Into<Option<String>>) -> Self {
        AppError {
            code: code.as_str().to_string(),
            message: code.message().to_string(),
            detail: detail.into(),
            path: None,
        }
    }

    pub fn with_path(mut self, path: impl Into<String>) -> Self {
        self.path = Some(path.into());
        self
    }

    pub fn path_not_found(display_name: &str) -> Self {
        Self::new(
            AppErrorCode::EPathNotFound,
            format!(
                "Onboard could not find {display_name}. It may have been moved, renamed, or deleted."
            ),
        )
    }

    pub fn not_a_directory(display_name: &str) -> Self {
        Self::new(
            AppErrorCode::ENotADirectory,
            format!("{display_name} is a file, not a folder. Choose a folder instead."),
        )
    }

    /// A genuine Section 12 gap: the spec requires refusing a system root
    /// (`/`, `C:\`, `/home`, `/Users`) but the closed `AppErrorCode` set has
    /// no dedicated code for it. `E_NOT_A_DIRECTORY` is the closest existing
    /// fit — logged in `docs/DECISIONS.md`.
    pub fn system_root(display_name: &str) -> Self {
        Self::new(
            AppErrorCode::ENotADirectory,
            format!(
                "{display_name} is a system root, not a project folder. Choose a folder such as one under your home directory."
            ),
        )
    }

    pub fn permission_denied(display_name: &str) -> Self {
        Self::new(
            AppErrorCode::EPermissionDenied,
            format!(
                "The operating system denied read access to {display_name}. Grant read permission, or pick a folder you own."
            ),
        )
    }

    pub fn no_supported_files() -> Self {
        Self::new(
            AppErrorCode::ENoSupportedFiles,
            "Onboard v1 reads JavaScript, TypeScript, and Python. This folder has none outside ignored paths. Go and Rust support is planned.".to_string(),
        )
    }

    pub fn repo_too_large(file_count: u64) -> Self {
        Self::new(
            AppErrorCode::ERepoTooLarge,
            format!(
                "{file_count} source files exceed the 25,000-file limit. Pick a subdirectory such as src/ to map a slice of it."
            ),
        )
    }

    pub fn engine_crashed(log_path: &str) -> Self {
        Self::new(
            AppErrorCode::EEngineCrashed,
            format!(
                "The analysis engine exited before finishing. The log is at {log_path}. Retrying usually works — the cache keeps completed files."
            ),
        )
    }

    pub fn engine_timeout(seconds: u64) -> Self {
        Self::new(
            AppErrorCode::EEngineTimeout,
            format!(
                "The analysis engine did not respond within {seconds}s and was stopped. Retrying usually works — the cache keeps completed files."
            ),
        )
    }

    pub fn analysis_in_progress() -> Self {
        Self::new(
            AppErrorCode::EAnalysisInProgress,
            "Wait for the current analysis to finish before starting another one.".to_string(),
        )
    }

    pub fn no_analysis() -> Self {
        Self::new(
            AppErrorCode::ENoAnalysis,
            "Run an analysis for this repository before searching it.".to_string(),
        )
    }

    pub fn file_too_large(display_name: &str, size_human: &str) -> Self {
        Self::new(
            AppErrorCode::EFileTooLarge,
            format!(
                "{display_name} is {size_human}. Onboard displays files up to 2 MB. Open it in your editor instead."
            ),
        )
    }

    pub fn path_escapes_repo(offending_path: &str) -> Self {
        Self::new(
            AppErrorCode::EPathEscapesRepo,
            "The requested path resolves outside the analyzed repository and was refused."
                .to_string(),
        )
        .with_path(offending_path.to_string())
    }

    pub fn invalid_settings(detail: &str) -> Self {
        Self::new(AppErrorCode::EInvalidSettings, detail.to_string())
    }

    pub fn keychain_unavailable() -> Self {
        Self::new(
            AppErrorCode::EKeychainUnavailable,
            "Onboard won't write API keys to disk. Install gnome-keyring or KWallet, or use a session-only key that is forgotten when you quit.".to_string(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_crashed_uses_the_literal_section_10_message() {
        let err = AppError::engine_crashed("/tmp/onboard.log");

        assert_eq!(err.code, "E_ENGINE_CRASHED");
        assert_eq!(err.message, "Analysis stopped unexpectedly");
        assert!(err.detail.unwrap().contains("/tmp/onboard.log"));
    }

    #[test]
    fn permission_denied_uses_the_literal_section_10_message() {
        let err = AppError::permission_denied("acme-api");

        assert_eq!(err.message, "Onboard can't read this folder");
        assert!(err.detail.unwrap().contains("acme-api"));
    }

    #[test]
    fn file_too_large_uses_the_literal_section_10_message() {
        let err = AppError::file_too_large("big.log", "3.1 MB");

        assert_eq!(err.message, "File too large to display");
        let detail = err.detail.unwrap();
        assert!(detail.contains("big.log"));
        assert!(detail.contains("3.1 MB"));
    }

    #[test]
    fn every_code_serializes_to_its_literal_wire_string() {
        assert_eq!(AppErrorCode::EPathNotFound.as_str(), "E_PATH_NOT_FOUND");
        assert_eq!(AppErrorCode::EEngineCrashed.as_str(), "E_ENGINE_CRASHED");
        assert_eq!(
            AppErrorCode::EAnalysisInProgress.as_str(),
            "E_ANALYSIS_IN_PROGRESS"
        );
    }
}
