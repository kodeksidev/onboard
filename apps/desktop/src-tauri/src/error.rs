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
    /// The engine process could never be STARTED — the binary is missing
    /// from the installation, or the OS refused to execute it. Distinct
    /// from `EEngineCrashed`, which means a running engine died mid-work:
    /// here there was never a process at all, so "crashed" is not merely
    /// imprecise but false, and it sends the reader looking for a crash log
    /// that does not exist. Introduced after a packaged Windows build
    /// reported `E_ENGINE_CRASHED` for a sidecar it had never spawned.
    EEngineNotStarted,
    EEngineTimeout,
    /// The engine RESPONDED with an error it could not classify — it is
    /// alive and answering, and it did not exit. Distinct from
    /// `EEngineCrashed`, which is reserved for a dead transport
    /// (`RpcError::Closed`: the process exited or the pipe broke).
    ///
    /// The distinction is not cosmetic. `E_ENGINE_CRASHED`'s copy promises
    /// that retrying usually works and that the cache keeps completed
    /// files. For a deterministic engine-side failure — v0.1.0's
    /// `UNIQUE constraint failed: symbol.id` — both promises are false:
    /// re-parsing the same bytes fails identically every time, and the
    /// batch persist is wrapped in a transaction that rolls back to zero
    /// rows. Introduced after that error reached a user under a code whose
    /// every statement was untrue for it.
    EAnalysisFailed,
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
    /// Phase 12 step 6 (Section 8.10): the model's answer cited a path that
    /// is not in the index, cited a line that does not exist in a file that
    /// IS in the index, or cited nothing verifiable at all. The WHOLE
    /// answer is withheld — Section 8.10 step 3: "Never show a partially
    /// verified answer."
    EAiCitationRejected,
    /// Phase 12 step 5: Ollama specifically (never Anthropic)
    /// could not be reached at all — reclassified from a generic
    /// `E_AI_NETWORK` transport failure by `ai::ollama`, since for a
    /// local-only target that almost always means "Ollama isn't running,"
    /// not a generic connectivity problem. Section 10 gives this its own
    /// literal copy.
    EAiOllamaUnreachable,
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
            AppErrorCode::EEngineNotStarted => "E_ENGINE_NOT_STARTED",
            AppErrorCode::EEngineTimeout => "E_ENGINE_TIMEOUT",
            AppErrorCode::EAnalysisFailed => "E_ANALYSIS_FAILED",
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
            AppErrorCode::EAiCitationRejected => "E_AI_CITATION_REJECTED",
            AppErrorCode::EAiOllamaUnreachable => "E_AI_OLLAMA_UNREACHABLE",
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

    /// Section 10 amendment — "Onboard could not start its analysis engine".
    /// Kept byte-identical to `copy/messages.ts`'s `engineNotStarted`
    /// description; `messages.test.ts` asserts the rendered string, and
    /// `error.rs`'s own test asserts this one, so the two cannot drift apart
    /// silently.
    ///
    /// Deliberately says nothing about retrying: the install is broken, not
    /// the run, so a Retry button would loop the user through the identical
    /// failure. Contrast `E_ENGINE_CRASHED`, where retrying genuinely helps
    /// because the cache keeps completed files.
    pub fn engine_not_started(log_path: &str) -> Self {
        Self::new(
            AppErrorCode::EEngineNotStarted,
            format!(
                "The analysis engine is missing from this installation, so nothing was \
                 analyzed. Reinstalling Onboard should restore it. The log is at {log_path}."
            ),
        )
    }

    /// The engine reported a failure it did not describe in terms this app
    /// has a named state for. Says nothing about retrying and nothing about
    /// cache retention, because neither holds for a deterministic failure —
    /// see `AppErrorCode::EAnalysisFailed`.
    pub fn analysis_failed(log_path: &str) -> Self {
        Self::new(
            AppErrorCode::EAnalysisFailed,
            format!(
                "Onboard could not finish analyzing this repository. The engine reported an                  internal error, and it will report the same one if this repository is                  analyzed again. The log is at {log_path}."
            ),
        )
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

    /// Phase 12 step 6: `ai::pipeline`'s fail-closed gate found that a step
    /// of Section 12's mandatory ordered pipeline was skipped or ran out of
    /// order ("Skipping any step is a CRITICAL review finding"). This is the
    /// same family as R3's abort — the safety pipeline did not complete, so
    /// nothing is sent — hence the same code. `detail` carries which steps
    /// actually ran, for the local log; `message` never does. Logged in
    /// `docs/DECISIONS.md`.
    pub fn ai_pipeline_incomplete(detail: impl Into<String>) -> Self {
        Self::new(
            AppErrorCode::EAiPayloadUnsafe,
            "Onboard could not complete its privacy checks for this request, so nothing was sent. Restart Onboard and try again.",
        )
        .with_detail(detail.into())
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

    /// Phase 12 step 6: Onboard's OWN limit (Section 12:
    /// `AI_MAX_REQUESTS_PER_MINUTE = 10`), not a provider 429. Section 10's
    /// literal copy for this code names the provider ("{provider} is
    /// rate-limiting Onboard"), which would be a false statement here —
    /// nothing was sent, and the provider has no opinion. Same code (the
    /// UI's `E_AI_RATE_LIMITED` affordance is the right one: wait, then
    /// retry), honest description. Logged in `docs/DECISIONS.md`.
    pub fn ai_rate_limited_locally(retry_after_seconds: u64) -> Self {
        Self::new(
            AppErrorCode::EAiRateLimited,
            format!(
                "Onboard limits AI requests to 10 per minute. Wait {retry_after_seconds}s and try again. Nothing was sent."
            ),
        )
    }

    /// Phase 12 step 6: Section 12's `AI_MAX_CONCURRENT = 1`. Same code and
    /// same reasoning as [`Self::ai_rate_limited_locally`] — see that
    /// constructor's doc comment.
    pub fn ai_request_already_in_flight() -> Self {
        Self::new(
            AppErrorCode::EAiRateLimited,
            "Onboard runs one AI request at a time. Wait for the current one to finish, then try again. Nothing was sent.",
        )
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

    /// Section 10's literal copy for "Model cites a path not in the index",
    /// verbatim, with the offending path interpolated exactly as
    /// `apps/desktop/src/copy/messages.ts`'s `ERRORS.aiCitationRejected`
    /// does. `.path` carries the same offending path so the UI can show it
    /// without re-parsing `message` (acceptance criterion 18).
    pub fn ai_citation_rejected(offending_path: &str) -> Self {
        Self::new(
            AppErrorCode::EAiCitationRejected,
            format!(
                "The model referenced {offending_path}, which is not in the index. Onboard never shows paths it can't verify. Try a narrower question."
            ),
        )
        .with_path(offending_path.to_string())
    }

    /// The deliberate strengthening of Section 8.10 step 3 (logged in
    /// `docs/DECISIONS.md`): a path that IS in the index but carries a line
    /// number the file does not have is a citation that resolves to
    /// nothing, which is exactly the plausible-but-unresolvable case a bare
    /// membership check waves through. `.path` is the full offending
    /// citation (`path:line`), not just the path — the line is the part
    /// that failed, so hiding it would make the message unactionable.
    pub fn ai_citation_line_out_of_range(path: &str, line: u64, real_line_count: u64) -> Self {
        Self::ai_citation_line_out_of_range_text(path, &line.to_string(), real_line_count)
    }

    /// Same refusal, for a line number that does not fit in a `u64` at all.
    ///
    /// The citation regex captures `(\d+)`, so a digit run longer than `u64`
    /// can hold still MATCHES — it just cannot be parsed. Collapsing that to
    /// `None` skipped the range check and let the citation through, which is
    /// why this takes the raw text rather than a number: the refusal must be
    /// able to name what the model actually wrote.
    pub fn ai_citation_line_out_of_range_text(
        path: &str,
        line: &str,
        real_line_count: u64,
    ) -> Self {
        Self::new(
            AppErrorCode::EAiCitationRejected,
            format!(
                "The model referenced {path}:{line}, but that file has {real_line_count} lines. Onboard never shows citations it can't resolve. Try a narrower question."
            ),
        )
        .with_path(format!("{path}:{line}"))
    }

    /// Section 8.10's non-vacuousness case: "every citation resolves" is
    /// trivially true of an answer containing no citations at all, so an
    /// uncited answer is withheld rather than reported as verified. No
    /// offending path exists here, so `.path` stays `None`.
    pub fn ai_answer_uncited() -> Self {
        Self::new(
            AppErrorCode::EAiCitationRejected,
            "The model's answer pointed at no files, so none of it could be checked against the index. Onboard only shows answers whose claims resolve to real code. Try a narrower question.",
        )
    }

    /// Phase 13 finding H1. `[[path:line]]` is
    /// [`crate::privacy::verify_citations`]'s OUTPUT grammar and the UI's
    /// INPUT grammar, so a token the MODEL wrote is a citation claim
    /// wearing the verifier's own uniform — indistinguishable, downstream,
    /// from one the verifier actually checked. It is refused wholesale like
    /// any other unverifiable citation.
    ///
    /// `.path` stays `None` deliberately: the frontend renders
    /// `ERRORS.aiCitationRejected(path).description` ("The model referenced
    /// {path}, which is not in the index") whenever `.path` is non-empty,
    /// and that sentence is not what happened here — the claim may name a
    /// real indexed file. With `.path` absent the UI falls back to this
    /// `message`, exactly as it already does for
    /// [`AppError::ai_answer_uncited`].
    pub fn ai_citation_token_forged(claim: &str) -> Self {
        Self::new(
            AppErrorCode::EAiCitationRejected,
            format!(
                "The model wrote its own citation token for {claim} instead of letting Onboard verify it. Onboard only shows citations it produced itself. Try a narrower question."
            ),
        )
    }

    /// Section 10's literal copy for "Ollama not running":
    /// `apps/desktop/src/copy/messages.ts`'s `ERRORS.aiOllamaUnreachable`
    /// title is static ("Ollama isn't answering on 127.0.0.1:11434"); this
    /// `message` is that row's description, verbatim, with `model`
    /// interpolated exactly like the frontend copy does.
    pub fn ai_ollama_unreachable(model: &str, raw_detail: impl Into<String>) -> Self {
        Self::new(
            AppErrorCode::EAiOllamaUnreachable,
            format!(
                "Start Ollama and pull {model}, then test again. Static mode is unaffected — everything below still works."
            ),
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
    fn ai_ollama_unreachable_matches_the_literal_section_10_copy() {
        let err = AppError::ai_ollama_unreachable("llama3", "connection refused");

        assert_eq!(err.code, "E_AI_OLLAMA_UNREACHABLE");
        assert_eq!(
            err.message,
            "Start Ollama and pull llama3, then test again. Static mode is unaffected — everything below still works."
        );
        assert_eq!(err.detail.as_deref(), Some("connection refused"));
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
