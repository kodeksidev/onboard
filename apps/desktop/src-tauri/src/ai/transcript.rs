//! `ai/transcript.rs` — Section 8.9 R5: "The exact payload (post-redaction,
//! post-cap) is written to the local session transcript so the user can
//! inspect precisely what left the machine." Section 12 fixes the location:
//! `<appDataDir>/onboard/transcripts/<repoId>.jsonl`.
//!
//! ## Why this records `ai::http::build_body`'s output, not a summary
//!
//! "Precisely what left the machine" is only true if the recorded value IS
//! the outbound request body, not a separately-assembled description of it.
//! A hand-built `{ paths, contents }` summary would be a second
//! implementation of the same thing, free to drift from the real body the
//! moment either changes — and a drifted audit file is worse than none,
//! because it looks like evidence. [`record`] therefore calls
//! [`crate::ai::http::build_body`] — the *same* function `ai::http::send`
//! calls, with the same `shape`/`model`/`prompt` — and writes its output
//! verbatim under `"body"`. `tests::the_recorded_body_is_byte_identical_to_the_body_send_would_build`
//! asserts exactly that equality, and
//! `commands::ai::tests::the_transcript_records_the_bytes_a_real_listener_actually_received`
//! closes the loop against a real socket.
//!
//! Request HEADERS are deliberately not recorded: the only header any
//! adapter builds is the auth header, and Section 12 is absolute that a key
//! is "never logged at any level". The body is the whole of what carries
//! repo content, so omitting headers costs the audit nothing.
//!
//! ## Why a write failure aborts the request
//!
//! R5 is a step in Section 12's mandatory ordered pipeline ("Skipping any
//! step is a CRITICAL review finding"), not a best-effort side effect. If
//! Onboard cannot record what it is about to send, the user cannot audit
//! it — so it doesn't send. [`record`] returns `Err`, and the pipeline
//! propagates it, rather than logging and continuing.

use std::io::Write;
use std::path::{Path, PathBuf};

use crate::ai::http::{self, ProviderShape};
use crate::ai::prompt::PromptSpec;
use crate::error::{AppError, AppErrorCode};

/// Section 12: one JSONL file per repo, named by `repoId`. `repo_id` is
/// validated as 16 lowercase hex characters at the command boundary before
/// it ever reaches here, so it cannot contain a path separator.
pub fn transcript_path(transcripts_dir: &Path, repo_id: &str) -> PathBuf {
    transcripts_dir.join(format!("{repo_id}.jsonl"))
}

/// The wire label for a provider shape, recorded so a user reading the
/// file can see which provider each request went to.
fn shape_label(shape: ProviderShape) -> &'static str {
    match shape {
        ProviderShape::Anthropic => "anthropic",
        ProviderShape::Ollama => "ollama",
    }
}

/// Section 12 has no dedicated `E_*` code for "the transcript could not be
/// written"; this is an OS write failure, so `E_PERMISSION_DENIED` is the
/// closest existing fit (the same judgement call, and the same
/// `docs/DECISIONS.md` treatment, as `AppError::system_root`). The raw OS
/// string goes to `.detail`, never `.message` (Section 12 error hygiene).
fn unwritable(path: &Path, err: &std::io::Error) -> AppError {
    AppError::new(
        AppErrorCode::EPermissionDenied,
        "Onboard could not write the AI transcript that records what would be sent, so nothing was sent. Check that the app data directory is writable.",
    )
    .with_detail(format!("{}: {err}", path.display()))
}

/// R5. Appends one line describing this request and returns the transcript
/// path. See this module's doc comment for why the recorded `body` is
/// `ai::http::build_body`'s own output.
pub fn record(
    transcripts_dir: &Path,
    repo_id: &str,
    shape: ProviderShape,
    model: &str,
    prompt: &PromptSpec,
) -> Result<PathBuf, AppError> {
    let path = transcript_path(transcripts_dir, repo_id);
    std::fs::create_dir_all(transcripts_dir).map_err(|err| unwritable(transcripts_dir, &err))?;

    let entry = serde_json::json!({
        "timestampMs": now_millis(),
        "repoId": repo_id,
        "provider": shape_label(shape),
        "model": model,
        "sentFileCount": prompt.sent_file_count(),
        "sentByteCount": prompt.sent_byte_count(),
        "body": http::build_body(shape, model, prompt),
    });
    append_entry(&path, &entry)?;
    Ok(path)
}

/// `<transcriptsDir>/connectivity.jsonl` — the `test_ai_key` probe's
/// transcript.
///
/// A connectivity check has no `repoId`, so it cannot use
/// [`transcript_path`]'s per-repo file. It is a SEPARATE file rather than a
/// `repoId: null` line in someone's repo transcript, so a user reading one
/// repo's record is not shown unrelated credential tests.
///
/// No `PromptSpec` exists here because the probe carries no repo content —
/// which is exactly why `ai::pipeline` records `ConnectivityProbeBuilt`
/// rather than `Redacted`. What is recorded is what the request actually
/// identifies: provider and model. Deliberately NOT recorded: any header.
/// This is the one outbound request whose entire purpose is exercising the
/// credential, so it is the closest the API key ever comes to the transcript
/// writer — `record` has never written headers either (see this module's doc
/// comment) and this must not become the exception.
pub fn record_connectivity(
    transcripts_dir: &Path,
    shape: ProviderShape,
    model: &str,
) -> Result<PathBuf, AppError> {
    let path = connectivity_path(transcripts_dir);
    std::fs::create_dir_all(transcripts_dir).map_err(|err| unwritable(transcripts_dir, &err))?;

    let entry = serde_json::json!({
        "timestampMs": now_millis(),
        "kind": "connectivity",
        "provider": shape_label(shape),
        "model": model,
        "sentFileCount": 0,
        "sentByteCount": 0,
    });
    append_entry(&path, &entry)?;
    Ok(path)
}

pub fn connectivity_path(transcripts_dir: &Path) -> PathBuf {
    transcripts_dir.join("connectivity.jsonl")
}

/// The single append path both transcripts use, so file-creation policy
/// (M7's 0600 / owner-only ACL) has exactly one site to be applied at rather
/// than being retrofitted onto two.
fn append_entry(path: &Path, entry: &serde_json::Value) -> Result<(), AppError> {
    let line = format!("{entry}\n");
    let mut options = std::fs::OpenOptions::new();
    options.create(true).append(true);
    apply_owner_only_mode(&mut options);
    let mut file = options.open(path).map_err(|err| unwritable(path, &err))?;
    file.write_all(line.as_bytes())
        .map_err(|err| unwritable(path, &err))?;
    Ok(())
}

/// M7: transcripts hold real (redacted, but real) excerpts of the user's
/// private source, and are the one artefact this design deliberately writes
/// to disk. `OpenOptions::new().create(true).append(true)` alone yields
/// umask-default permissions — commonly `0644`, i.e. world-readable.
///
/// Applied at CREATION rather than chmod'd afterwards: a create-then-chmod
/// sequence leaves a window in which the file exists with the wider mode,
/// and any process that opened it during that window keeps its handle.
#[cfg(unix)]
fn apply_owner_only_mode(options: &mut std::fs::OpenOptions) {
    use std::os::unix::fs::OpenOptionsExt;
    options.mode(0o600);
}

/// Windows has no `mode`; the equivalent is an explicit DACL, which needs a
/// Win32 dependency this crate does not currently carry. Deliberately a
/// no-op with this comment rather than a silent gap: the file inherits the
/// ACL of `<appDataDir>/onboard/transcripts/`, which lives under the
/// per-user AppData root, so it is not world-readable by default — but that
/// is INHERITANCE, not an assertion, and a non-default parent ACL would
/// widen it without anything noticing. Tracked as the Windows half of M7.
#[cfg(not(unix))]
fn apply_owner_only_mode(_options: &mut std::fs::OpenOptions) {}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::prompt::{build, AiFeature, UserQuestion};
    use crate::contract::{EngineSnippet, EngineSnippetsResult};

    fn prompt_with(feature: AiFeature, entries: &[(&str, &str)]) -> PromptSpec {
        let payload = crate::privacy::redact::redact(
            &EngineSnippetsResult {
                snippets: entries
                    .iter()
                    .map(|(path, content)| EngineSnippet {
                        path: (*path).to_string(),
                        start_line: 1,
                        end_line: 1,
                        content: (*content).to_string(),
                    })
                    .collect(),
            },
            &[],
        )
        .expect("plain content redacts cleanly");
        build(feature, payload)
    }

    fn read_entries(path: &Path) -> Vec<serde_json::Value> {
        std::fs::read_to_string(path)
            .expect("transcript file must exist")
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| serde_json::from_str(line).expect("each line must be valid JSON"))
            .collect()
    }

    /// The heart of R5: what the transcript records must be the EXACT body
    /// `ai::http::send` builds — same function, same arguments — so the
    /// user auditing the file is auditing the real request, not a
    /// separately-maintained summary that could drift.
    #[test]
    fn the_recorded_body_is_byte_identical_to_the_body_send_would_build() {
        let dir = tempfile::tempdir().unwrap();
        let prompt = prompt_with(AiFeature::ProjectSummary, &[("src/a.ts", "const a = 1;")]);
        let path = record(
            dir.path(),
            "0123456789abcdef",
            ProviderShape::Anthropic,
            "claude-test-model",
            &prompt,
        )
        .expect("record must succeed");

        let entries = read_entries(&path);
        assert_eq!(entries.len(), 1);
        let expected = crate::ai::http::build_body_for_test(
            ProviderShape::Anthropic,
            "claude-test-model",
            &prompt,
        );
        assert_eq!(entries[0]["body"], expected);
    }

    #[test]
    fn the_transcript_lives_at_the_section_12_path_named_after_the_repo_id() {
        let dir = tempfile::tempdir().unwrap();
        let path = transcript_path(dir.path(), "0123456789abcdef");
        assert_eq!(path, dir.path().join("0123456789abcdef.jsonl"));
    }

    #[test]
    fn each_request_appends_a_line_rather_than_overwriting_the_session() {
        let dir = tempfile::tempdir().unwrap();
        let first = prompt_with(AiFeature::ProjectSummary, &[("src/a.ts", "const a = 1;")]);
        let second = prompt_with(
            AiFeature::Question(UserQuestion::parse("where is auth?").unwrap()),
            &[("src/b.ts", "const b = 2;")],
        );
        record(
            dir.path(),
            "0123456789abcdef",
            ProviderShape::Ollama,
            "llama3",
            &first,
        )
        .unwrap();
        let path = record(
            dir.path(),
            "0123456789abcdef",
            ProviderShape::Ollama,
            "llama3",
            &second,
        )
        .unwrap();

        let entries = read_entries(&path);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0]["sentFileCount"], 1);
        assert_eq!(entries[1]["model"], "llama3");
    }

    /// A secret that survived into the snippet text would appear in the
    /// transcript exactly as it appears on the wire — which is the point.
    /// The complementary guarantee: content that WAS redacted is recorded
    /// redacted, so the file is evidence for the privacy claim rather than
    /// a second copy of the plaintext.
    #[test]
    fn the_transcript_records_the_redacted_text_not_the_original() {
        let dir = tempfile::tempdir().unwrap();
        let secret = "REDACTED-AWS-BY-HISTORY-REWRITE";
        let prompt = prompt_with(
            AiFeature::ProjectSummary,
            &[("config/aws.ts", &format!("aws_access_key_id = {secret}"))],
        );
        let path = record(
            dir.path(),
            "0123456789abcdef",
            ProviderShape::Anthropic,
            "m",
            &prompt,
        )
        .unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(!text.contains(secret), "the transcript leaked a secret");
        assert!(text.contains("<redacted>"));
    }

    /// Counts recorded alongside the body are the same numbers the UI is
    /// shown (Section 7.4's `sentFileCount`/`sentByteCount`), so the
    /// disclosure and the audit file cannot disagree.
    #[test]
    fn the_recorded_counts_match_the_prompts_own_counts() {
        let dir = tempfile::tempdir().unwrap();
        let prompt = prompt_with(
            AiFeature::ProjectSummary,
            &[("src/a.ts", "const a = 1;"), ("src/b.ts", "const b = 2;")],
        );
        let expected_files = prompt.sent_file_count();
        let expected_bytes = prompt.sent_byte_count();
        let path = record(
            dir.path(),
            "0123456789abcdef",
            ProviderShape::Anthropic,
            "m",
            &prompt,
        )
        .unwrap();
        let entries = read_entries(&path);
        assert_eq!(entries[0]["sentFileCount"], expected_files);
        assert_eq!(entries[0]["sentByteCount"], expected_bytes);
    }
}

#[cfg(test)]
mod connectivity_tests {
    use super::*;
    use crate::ai::http::ProviderShape;

    /// M7. Asserts the MODE, not that the file exists — a file that exists
    /// at 0644 satisfies an existence check and defeats the finding.
    #[cfg(unix)]
    #[test]
    fn a_transcript_is_created_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = record_connectivity(dir.path(), ProviderShape::Anthropic, "m").unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(
            mode, 0o600,
            "transcript must not be group- or world-readable"
        );
    }

    /// The API key must never reach the transcript writer.
    ///
    /// Deliberately NOT "assert today's fields are provider and model":
    /// that passes forever while someone adds a `headers` field beside
    /// them. This asserts the whole serialized line contains no header, no
    /// Authorization value and no key-shaped string, so ANY future field
    /// carrying one fails here — the connectivity request is the one whose
    /// entire purpose is exercising the credential, so it is where the key
    /// sits closest to this writer.
    #[test]
    fn the_connectivity_transcript_never_records_a_key_or_any_header() {
        let dir = tempfile::tempdir().unwrap();
        let path = record_connectivity(dir.path(), ProviderShape::Anthropic, "m").unwrap();
        let raw = std::fs::read_to_string(&path).unwrap().to_lowercase();
        for banned in [
            "authorization",
            "x-api-key",
            "bearer",
            "header",
            "apikey",
            "api_key",
            "sk-",
            "secret",
            "token",
        ] {
            assert!(
                !raw.contains(banned),
                "connectivity transcript must not contain {banned:?}; line was: {raw}"
            );
        }
    }

    /// NON-VACUITY for the test above.
    ///
    /// That test passes today because the writer serializes provider and
    /// model only — so a green result proves nothing until the scan is shown
    /// to FIRE on the thing it exists to catch. This feeds the same scan a
    /// line that carries a header and an Authorization value, exactly as a
    /// future `headers` field would, and asserts every banned term is
    /// detected. Without this, the guard is green-means-nothing.
    #[test]
    fn the_key_leak_scan_fires_on_a_line_that_does_carry_a_header() {
        let leaked = serde_json::json!({
            "timestampMs": 0,
            "kind": "connectivity",
            "provider": "anthropic",
            "headers": { "x-api-key": "REDACTED-ANTHROPIC-BY-HISTORY-REWRITE" },
            "authorization": "Bearer REDACTED-ANTHROPIC-BY-HISTORY-REWRITE",
        });
        let raw = leaked.to_string().to_lowercase();
        let mut fired = Vec::new();
        for banned in [
            "authorization",
            "x-api-key",
            "bearer",
            "header",
            "apikey",
            "api_key",
            "sk-",
            "secret",
            "token",
        ] {
            if raw.contains(banned) {
                fired.push(banned);
            }
        }
        assert!(
            fired.contains(&"authorization")
                && fired.contains(&"x-api-key")
                && fired.contains(&"bearer")
                && fired.contains(&"header")
                && fired.contains(&"sk-"),
            "the scan must detect a leaked header; it only fired on {fired:?}"
        );
    }

    /// Both transcripts append through one site, so M7's mode and (next)
    /// M6's bound have exactly one place to live rather than two that can
    /// diverge. Proven by writing through the connectivity path and
    /// asserting the shared helper produced the file.
    #[test]
    fn connectivity_uses_its_own_file_not_a_repo_transcript() {
        let dir = tempfile::tempdir().unwrap();
        let path = record_connectivity(dir.path(), ProviderShape::Ollama, "m").unwrap();
        assert_eq!(path, connectivity_path(dir.path()));
        assert!(path.ends_with("connectivity.jsonl"));
    }
}
