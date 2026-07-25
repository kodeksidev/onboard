//! File logging to `<appLogDir>/onboard/onboard.log`, rotated at 5 MB × 3
//! files (Section 12). Deliberately minimal: callers are responsible for
//! never passing file contents, keys, or repo-external absolute paths into
//! `log_line` — this module does not attempt content-aware redaction
//! (that is `privacy::redact`, Phase 12's job for the AI payload only).
//!
//! Each call opens, writes, and closes the file rather than holding a
//! long-lived handle: Windows refuses to rename a file that is still open
//! without `FILE_SHARE_DELETE` (not set by default), and rotation relies
//! on a plain rename, so no handle may outlive a single `log_line` call.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Rotation threshold (Section 12: "rotate at 5 MB × 3 files").
pub const LOG_ROTATE_MAX_BYTES: u64 = 5 * 1024 * 1024;
/// Number of rotated backups kept alongside the live file (`.1`, `.2`, `.3`).
pub const LOG_ROTATE_BACKUP_COUNT: u32 = 3;

pub struct RotatingLogger {
    path: PathBuf,
    write_lock: Mutex<()>,
}

impl RotatingLogger {
    pub fn open(path: &Path) -> std::io::Result<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        // Touch the file so callers can rely on it existing immediately.
        OpenOptions::new().create(true).append(true).open(path)?;
        Ok(RotatingLogger {
            path: path.to_path_buf(),
            write_lock: Mutex::new(()),
        })
    }

    /// Appends one line (a trailing `\n` is added), rotating first when the
    /// live file has already crossed the size threshold.
    pub fn log_line(&self, line: &str) -> std::io::Result<()> {
        let _guard = self.write_lock.lock().expect("log file mutex poisoned");
        if fs::metadata(&self.path)?.len() >= LOG_ROTATE_MAX_BYTES {
            self.rotate()?;
        }
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        writeln!(file, "{line}")?;
        file.flush()
    }

    fn rotate(&self) -> std::io::Result<()> {
        for index in (1..LOG_ROTATE_BACKUP_COUNT).rev() {
            let from = self.backup_path(index);
            let to = self.backup_path(index + 1);
            if from.exists() {
                let _ = fs::rename(&from, &to);
            }
        }
        let first_backup = self.backup_path(1);
        if self.path.exists() {
            fs::rename(&self.path, &first_backup)?;
        }
        Ok(())
    }

    fn backup_path(&self, index: u32) -> PathBuf {
        let mut name = self
            .path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "onboard.log".to_string());
        name.push_str(&format!(".{index}"));
        self.path.with_file_name(name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotates_when_the_live_file_exceeds_the_threshold() {
        let dir = tempfile::tempdir().unwrap();
        let log_path = dir.path().join("onboard.log");
        let logger = RotatingLogger::open(&log_path).unwrap();

        let file = OpenOptions::new().write(true).open(&log_path).unwrap();
        file.set_len(LOG_ROTATE_MAX_BYTES).unwrap();
        drop(file);

        logger.log_line("first line after rotation").unwrap();

        assert!(dir.path().join("onboard.log.1").exists());
        let contents = fs::read_to_string(&log_path).unwrap();
        assert!(contents.contains("first line after rotation"));
    }

    #[test]
    fn keeps_at_most_three_backups() {
        let dir = tempfile::tempdir().unwrap();
        let log_path = dir.path().join("onboard.log");
        let logger = RotatingLogger::open(&log_path).unwrap();

        for i in 0..5 {
            let file = OpenOptions::new().write(true).open(&log_path).unwrap();
            file.set_len(LOG_ROTATE_MAX_BYTES).unwrap();
            drop(file);
            logger.log_line(&format!("line {i}")).unwrap();
        }

        assert!(dir.path().join("onboard.log.1").exists());
        assert!(dir.path().join("onboard.log.2").exists());
        assert!(dir.path().join("onboard.log.3").exists());
        assert!(!dir.path().join("onboard.log.4").exists());
    }
}
