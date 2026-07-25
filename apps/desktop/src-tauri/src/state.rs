//! `AppState` — everything Tauri commands share: the sidecar supervisor,
//! the map of analyzed repos (`repoId -> absolute root`, needed for
//! `read_repo_file`'s confinement check), the AI key store, and the
//! rotating log file handle.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use crate::secrets::ai_key::AiKeyStore;
use crate::sidecar::supervisor::SidecarSupervisor;
use crate::util::logging::RotatingLogger;

/// What `analyze_repo` remembers about a completed analysis, keyed by the
/// `repoId` the engine returned. The absolute root is kept ONLY here — it
/// is never emitted in `AnalysisResult` (Section 6.1) and never logged.
pub struct RepoSession {
    pub repo_root: PathBuf,
}

pub struct AppState {
    pub supervisor: SidecarSupervisor,
    pub sessions: Mutex<HashMap<String, RepoSession>>,
    pub ai_keys: AiKeyStore,
    pub logger: RotatingLogger,
}

impl AppState {
    pub fn record_session(&self, repo_id: String, repo_root: PathBuf) {
        self.sessions
            .lock()
            .expect("sessions map poisoned")
            .insert(repo_id, RepoSession { repo_root });
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
