//! `AppError` — the error envelope shared verbatim with the TS contract
//! (Section 7, closing block; `packages/contract/src/error.ts`).
//!
//! Section 10's rows each show two strings per error: a short, static,
//! per-code title ("**That folder no longer exists**") and a longer,
//! often-parameterized description ("Onboard could not find {name}...").
//! `AppError` has exactly one text field, `message` — and per Section 12,
//! "`AppError.message` is always drawn from the copy table in Section 10".
//! `react-ui`'s own copy table (`src/copy/messages.ts`) resolves the title
//! from `code` alone (it is static and needs no runtime value) and treats
//! `error.message` as the description — the only half that actually needs a
//! value only Rust has (a file name, a byte count, a log path). `message`
//! here is therefore always that long, parameterized description; the short
//! titles are never constructed on this side at all. `detail` is reserved
//! for genuine extra diagnostics this crate doesn't currently have (a raw
//! OS/provider error string) — never a second copy of `message`.

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
    /// Phase 12 step 1 (Section 8.9 R3): the redaction pass's own
    /// idempotence re-scan still matched something after one full R1-R4
    /// pass — the request is aborted outright rather than sending a
    /// partially-redacted payload.
    EAiPayloadUnsafe,
    /// Phase 12 step 2 (Section 12): `settings.ai.isEnabled !== true`, or no
    /// key is retrievable — checked before any other AI work, including
    /// before an `EgressPermit` can even be constructed (`ai::permit`).
    EAiDisabled,
    /// Phase 12 step 2: a transport-level failure (DNS, connection refused,
    /// TLS, timeout) or an HTTP response `ai::http::send` doesn't have a
    /// more specific code for.
    EAiNetwork,
    /// Phase 12 step 2: the provider responded 401.
    EAiKeyInvalid,
    /// Phase 12 step 2: the provider responded 429.
    EAiRateLimited,
    /// Phase 12 step 2: the provider responded 404 for the configured model.
    EAiModelNotFound,
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
            AppErrorCode::EAiPayloadUnsafe => "E_AI_PAYLOAD_UNSAFE",
            AppErrorCode::EAiDisabled => "E_AI_DISABLED",
            AppErrorCode::EAiNetwork => "E_AI_NETWORK",
            AppErrorCode::EAiKeyInvalid => "E_AI_KEY_INVALID",
            AppErrorCode::EAiRateLimited => "E_AI_RATE_LIMITED",
            AppErrorCode::EAiModelNotFound => "E_AI_MODEL_NOT_FOUND",
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
    /// `message` is the long, parameterized Section 10 description (see
    /// this module's doc comment) — never the short static title.
    pub fn new(code: AppErrorCode, message: impl Into<String>) -> Self {
        AppError {
            code: code.as_str().to_string(),
            message: message.into(),
            detail: None,
            path: None,
        }
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
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
            "Onboard v1 reads JavaScript, TypeScript, and Python. This folder has none outside ignored paths. Go and Rust support is planned.",
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
            "Wait for the current analysis to finish before starting another one.",
        )
    }

    pub fn no_analysis() -> Self {
        Self::new(
            AppErrorCode::ENoAnalysis,
            "Run an analysis for this repository before searching it.",
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
            "The requested path resolves outside the analyzed repository and was refused.",
        )
        .with_path(offending_path.to_string())
    }

    /// `message` here is caller-supplied (there is no single Section 10
    /// template for every settings-validation failure), matching the same
    /// "long description, no static title" convention as every other
    /// constructor.
    pub fn invalid_settings(message: &str) -> Self {
        Self::new(AppErrorCode::EInvalidSettings, message.to_string())
    }

    pub fn keychain_unavailable() -> Self {
        Self::new(
            AppErrorCode::EKeychainUnavailable,
            "Onboard won't write API keys to disk. Install gnome-keyring or KWallet, or use a session-only key that is forgotten when you quit.",
        )
    }

    /// Section 10 gives no literal copy for this code (only Section 12's R3
    /// behavior description exists: "A secret survives redaction; nothing
    /// is sent"); this message follows the same voice as the rows that do
    /// have literal copy — logged in `docs/DECISIONS.md`.
    pub fn ai_payload_unsafe() -> Self {
        Self::new(
            AppErrorCode::EAiPayloadUnsafe,
            "Onboard found what still looks like a secret after redacting this content, so nothing was sent. Exclude the affected file or remove the secret, then try again.",
        )
    }

    /// Section 12: "`settings.ai.isEnabled === true` **and** a key is
    /// retrievable; otherwise `E_AI_DISABLED` before any other work." No
    /// literal Section 10 copy exists for this exact string (only the
    /// behavior is specified) — conventional phrasing, logged in
    /// `docs/DECISIONS.md`.
    pub fn ai_disabled() -> Self {
        Self::new(
            AppErrorCode::EAiDisabled,
            "Turn on AI in Settings and store a working API key to use this feature. Static mode still works fully without it.",
        )
    }

    /// `detail` carries the raw transport failure text (Section 12: never
    /// in `message`). `is_timeout` distinguishes the one case Section 12
    /// asks be told apart in copy ("the request... timed out" vs "could not
    /// reach").
    pub fn ai_network(is_timeout: bool, raw_detail: impl Into<String>) -> Self {
        let message = if is_timeout {
            "The request to the AI provider timed out."
        } else {
            "Onboard could not reach the AI provider. Check your network connection and try again."
        };
        Self::new(AppErrorCode::EAiNetwork, message).with_detail(raw_detail.into())
    }

    /// Section 10: "{provider} returned 401. Check the key, then test
    /// again. AI stays off until a key passes." `provider` is a plain
    /// string here (not the `AiProvider` enum) — this module does not
    /// depend on `commands::settings` for a single interpolated name.
    pub fn ai_key_invalid(provider: &str, raw_detail: impl Into<String>) -> Self {
        Self::new(
            AppErrorCode::EAiKeyInvalid,
            format!("{provider} returned 401. Check the key, then test again. AI stays off until a key passes."),
        )
        .with_detail(raw_detail.into())
    }

    /// Section 10: "Wait {n}s and try again. Nothing was sent twice." — no
    /// automatic retry (Section 12), so "sent twice" never applies here;
    /// `retry_after_seconds` is `None` when the provider didn't send one.
    pub fn ai_rate_limited(
        provider: &str,
        retry_after_seconds: Option<u64>,
        raw_detail: impl Into<String>,
    ) -> Self {
        let wait_clause = match retry_after_seconds {
            Some(seconds) => format!("Wait {seconds}s and try again."),
            None => "Wait a moment and try again.".to_string(),
        };
        Self::new(
            AppErrorCode::EAiRateLimited,
            format!("{provider} is rate-limiting Onboard. {wait_clause} Nothing was sent twice."),
        )
        .with_detail(raw_detail.into())
    }

    /// No literal Section 10 copy exists for this exact string (the row
    /// documents `E_AI_MODEL_NOT_FOUND` only in Section 7.4's error-code
    /// column, not in Section 10's table) — conventional phrasing, logged
    /// in `docs/DECISIONS.md`.
    pub fn ai_model_not_found(provider: &str, model: &str, raw_detail: impl Into<String>) -> Self {
        Self::new(
            AppErrorCode::EAiModelNotFound,
            format!("{provider} doesn't have a model named \"{model}\". Check the model name in Settings."),
        )
        .with_detail(raw_detail.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_crashed_uses_the_literal_section_10_description_as_message() {
        let err = AppError::engine_crashed("/tmp/onboard.log");

        assert_eq!(err.code, "E_ENGINE_CRASHED");
        assert!(err
            .message
            .contains("The analysis engine exited before finishing"));
        assert!(err.message.contains("/tmp/onboard.log"));
        assert!(err.detail.is_none());
    }

    #[test]
    fn permission_denied_uses_the_literal_section_10_description_as_message() {
        let err = AppError::permission_denied("acme-api");

        assert!(err
            .message
            .contains("The operating system denied read access"));
        assert!(err.message.contains("acme-api"));
    }

    #[test]
    fn file_too_large_uses_the_literal_section_10_description_as_message() {
        let err = AppError::file_too_large("big.log", "3.1 MB");

        assert!(err.message.contains("big.log"));
        assert!(err.message.contains("3.1 MB"));
        assert!(err.message.contains("Onboard displays files up to 2 MB"));
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

    #[test]
    fn with_detail_attaches_developer_only_diagnostic_text() {
        let err =
            AppError::engine_crashed("/tmp/onboard.log").with_detail("spawn failed: os error 2");
        assert_eq!(err.detail.as_deref(), Some("spawn failed: os error 2"));
    }
}
