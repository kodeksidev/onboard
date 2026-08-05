//! `AppState` — everything Tauri commands share: the sidecar supervisor,
//! the map of analyzed repos (`repoId -> absolute root`, needed for
//! `read_repo_file`'s confinement check), the AI key store, and the
//! rotating log file handle.

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::Mutex;

use crate::ai::rate_limit::AiRateLimiter;
use crate::contract::AnalysisResult;
use crate::error::AppError;
use crate::secrets::ai_key::AiKeyStore;
use crate::sidecar::supervisor::SidecarSupervisor;
use crate::util::logging::RotatingLogger;

/// What `analyze_repo` remembers about a completed analysis, keyed by the
/// `repoId` the engine returned. The absolute root is kept ONLY here — it
/// is never emitted in `AnalysisResult` (Section 6.1) and never logged.
///
/// Phase 12 step 6 added the three AI-path projections below. They are
/// deliberately projections rather than a retained `AnalysisResult`: the
/// AI path needs exactly (a) which files to ask `engine.snippets` for and
/// (b) which paths/line counts a citation may resolve to, and keeping a
/// whole envelope per repo alive for that would be a large, mostly-unused
/// allocation. Nothing here is file CONTENT — that only ever comes from
/// `engine.snippets` (`ai::snippets`).
#[derive(Debug, Default)]
pub struct RepoSession {
    pub repo_root: PathBuf,
    /// `AnalysisResult.importantFilePaths`, already in importance order —
    /// the ranked candidate list `ai_project_summary` sends to
    /// `engine.snippets` (Section 8.9 R4 keeps the head, drops the tail).
    pub important_file_paths: Vec<String>,
    /// `ModuleCard.id` → `ModuleCard.keyFilePaths`, for
    /// `ai_explain_module`.
    pub module_key_file_paths: BTreeMap<String, Vec<String>>,
    /// Every indexed path with its real line count — the input to Section
    /// 8.10's `CitationIndex`, including this crate's deliberate
    /// strengthening of step 3 (a cited line must exist).
    pub file_line_counts: Vec<(String, u64)>,
}

pub struct AppState {
    pub supervisor: SidecarSupervisor,
    pub sessions: Mutex<HashMap<String, RepoSession>>,
    pub ai_keys: AiKeyStore,
    /// Section 12's `AI_MAX_REQUESTS_PER_MINUTE`/`AI_MAX_CONCURRENT`, for
    /// the whole app process (the limits are Onboard's, not per-repo).
    pub ai_rate_limiter: AiRateLimiter,
    pub logger: RotatingLogger,
}

impl AppState {
    /// Records an `AppError` in `onboard.log` with its code and developer
    /// detail, and returns it unchanged so call sites stay `?`-shaped.
    ///
    /// Before v0.1.1 the log had exactly two call sites, both about sidecar
    /// resolution, so an error that reached the UI left no trace in the file
    /// the error copy tells the user to open. `E_ENGINE_CRASHED`'s copy
    /// named a log that could not describe the crash.
    ///
    /// Section 12 constrains what may be logged — no file contents, no
    /// keys, no repo-external paths — and none of that appears here.
    /// `code` is a fixed enum string and `detail` is the same developer
    /// text the UI already shows behind its Details disclosure, so this
    /// records nothing the user cannot already see on screen.
    pub fn log_app_error(&self, error: AppError) -> AppError {
        let detail = error.detail.as_deref().unwrap_or("(none)");
        let _ = self
            .logger
            .log_line(&format!("error {}: {}", error.code, detail));
        error
    }

    pub fn record_session(&self, repo_id: String, repo_root: PathBuf) {
        self.sessions.lock().expect("sessions map poisoned").insert(
            repo_id,
            RepoSession {
                repo_root,
                ..RepoSession::default()
            },
        );
    }

    /// The real `analyze_repo` path: records the repo root plus the three
    /// AI projections, derived once from the envelope the engine just
    /// returned rather than re-derived per AI request.
    pub fn record_analysis_session(
        &self,
        repo_id: String,
        repo_root: PathBuf,
        result: &AnalysisResult,
    ) {
        let session = RepoSession {
            repo_root,
            important_file_paths: result.important_file_paths.clone(),
            module_key_file_paths: result
                .modules
                .iter()
                .map(|module| (module.id.clone(), module.key_file_paths.clone()))
                .collect(),
            file_line_counts: result
                .files
                .iter()
                .map(|file| (file.path.clone(), file.line_count))
                .collect(),
        };
        self.sessions
            .lock()
            .expect("sessions map poisoned")
            .insert(repo_id, session);
    }

    /// Reads from a recorded session under the lock, without cloning the
    /// whole `RepoSession` or leaking the guard to callers.
    pub fn with_session<T>(
        &self,
        repo_id: &str,
        read: impl FnOnce(&RepoSession) -> T,
    ) -> Option<T> {
        self.sessions
            .lock()
            .expect("sessions map poisoned")
            .get(repo_id)
            .map(read)
    }

    pub fn repo_root_for(&self, repo_id: &str) -> Option<PathBuf> {
        self.sessions
            .lock()
            .expect("sessions map poisoned")
            .get(repo_id)
            .map(|session| session.repo_root.clone())
    }

    pub fn has_session(&self, repo_id: &str) -> bool {
        self.sessions
            .lock()
            .expect("sessions map poisoned")
            .contains_key(repo_id)
    }
}
