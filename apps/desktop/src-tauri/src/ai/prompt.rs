//! `ai/prompt.rs` — Phase 12 step 6: prompt construction for the three AI
//! features (Section 7.4's `ai_project_summary`, `ai_explain_module`,
//! `ai_ask`), plus the connectivity ping `test_ai_key` already used.
//!
//! ## Why [`PromptSpec`] exists, and what it must NOT become
//!
//! `ai::http::send` deliberately has no free-form `body: &Value` parameter
//! — see that module's doc comment for the owner's Phase 12 step 3A ruling.
//! Adding real prompts is exactly the change that could quietly re-open
//! that channel: the obvious implementation is `send(.., instructions:
//! &str, ..)`, and a caller-supplied `&str` reaching the request body is
//! the SAME defect pattern as a caller-supplied `Value` — a
//! caller-controlled path that can carry anything, including a second,
//! unredacted copy of repo content.
//!
//! [`PromptSpec`] closes it the same structural way `RedactedPayload`,
//! `EgressPermit` and `ResolvedEndpoint` closed theirs:
//!
//! - Every field is **private**; there is no `pub fn new`, no `Default`, no
//!   `serde::Deserialize`, no `From<String>`/`From<&str>`. The only place
//!   `PromptSpec { .. }` is written in this crate is inside [`build`],
//!   right here (`tests/ai_provider_body_compile_fail.rs` proves the
//!   struct-literal, `Default`, `Deserialize` and `From` routes are all
//!   compile errors from an external crate).
//! - `build` takes a **typed feature enum** plus a **`RedactedPayload`** —
//!   nothing else. `task` is `&'static str`, chosen by [`build`] from the
//!   fixed per-feature constants below; a caller cannot supply it, override
//!   it, or append to it.
//! - The only caller-authored text that can reach a `PromptSpec` at all is
//!   `ai_ask`'s question and `ai_explain_module`'s module id, and each must
//!   first survive [`UserQuestion::parse`] / [`ModuleId::parse`] (bounded
//!   length, non-blank). Each is carried in its own `subject` field and
//!   emitted as its OWN JSON leaf — never concatenated into `task` — so
//!   `ai::http`'s "every string leaf is exactly one thing" property (and
//!   the adapters' real-bytes leaf-walk tests) still holds.
//!
//! Net effect: `send` still owns JSON assembly, still has no body
//! parameter, and the WHAT leg is now `&PromptSpec` — a type that can only
//! be built FROM a `RedactedPayload`, so the redaction guarantee is
//! inherited rather than replaced.

use crate::constants::{AI_MODULE_ID_MAX_LEN, AI_QUESTION_MAX_LEN};
use crate::error::AppError;
use crate::privacy::redact::RedactedPayload;

/// A `ModuleCard.id` (Section 7.1) supplied by the webview. Validated at
/// the boundary (Section 12) and carried as an opaque newtype so a
/// hand-built `String` cannot reach [`build`].
#[derive(Debug)]
pub struct ModuleId(String);

impl ModuleId {
    pub fn parse(raw: &str) -> Result<Self, AppError> {
        let trimmed = raw.trim();
        if trimmed.is_empty() || trimmed.chars().count() > AI_MODULE_ID_MAX_LEN {
            return Err(AppError::invalid_settings(&format!(
                "moduleId must be 1-{AI_MODULE_ID_MAX_LEN} characters."
            )));
        }
        Ok(ModuleId(trimmed.to_string()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// `ai_ask`'s question — the ONLY user-authored free text the AI path ever
/// transmits. Bounded here; carried as its own JSON leaf by [`build`].
#[derive(Debug)]
pub struct UserQuestion(String);

impl UserQuestion {
    pub fn parse(raw: &str) -> Result<Self, AppError> {
        let trimmed = raw.trim();
        if trimmed.is_empty() || trimmed.chars().count() > AI_QUESTION_MAX_LEN {
            return Err(AppError::invalid_settings(&format!(
                "question must be 1-{AI_QUESTION_MAX_LEN} characters."
            )));
        }
        Ok(UserQuestion(trimmed.to_string()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// The closed set of things this app ever asks a model to do. There is no
/// `Custom(String)` variant, and adding one would be the change that
/// re-opens the free-form channel this module exists to keep shut.
#[derive(Debug)]
pub enum AiFeature {
    ProjectSummary,
    ModuleExplanation(ModuleId),
    Question(UserQuestion),
    /// `test_ai_key`'s round trip (Phase 12 step 5) — an empty payload and
    /// no subject, but the same `PromptSpec`/`send` path as a real
    /// feature, so "Test key" keeps proving the real chokepoint.
    ConnectivityCheck,
}

// Every feature's task string ends with the same citation instruction,
// because Section 8.10 rejects an answer whose citations don't resolve —
// and, per this crate's non-vacuousness strengthening, rejects one that
// cites nothing at all. A prompt that didn't ask for citations would make
// `E_AI_CITATION_REJECTED` the normal outcome rather than the exception.
// The sentence is repeated literally rather than shared through a `const`
// because `concat!` only accepts literals, and building these with
// `format!` would make `task` a runtime `String` — the exact thing
// `&'static str` is here to prevent.

const TASK_PROJECT_SUMMARY: &str = concat!(
    "Summarize what this project is and how it is structured, using only the code snippets \
     provided.",
    " Cite every claim with a backticked repo-relative `path:line` taken only from the snippets \
     provided; never name a file that is not among them."
);

const TASK_MODULE_EXPLANATION: &str = concat!(
    "Explain what the module named in `subject` does and how its files fit together, using only \
     the code snippets provided.",
    " Cite every claim with a backticked repo-relative `path:line` taken only from the snippets \
     provided; never name a file that is not among them."
);

const TASK_QUESTION: &str = concat!(
    "Answer the question in `subject` about this codebase, using only the code snippets provided. \
     If they do not contain the answer, say so.",
    " Cite every claim with a backticked repo-relative `path:line` taken only from the snippets \
     provided; never name a file that is not among them."
);

const TASK_CONNECTIVITY_CHECK: &str =
    "Reply with the single word OK. This is a connectivity check; no repository content is \
     attached.";

/// The WHAT leg of `ai::http::send`'s triad, from Phase 12 step 6 onward.
/// Private fields, no public constructor of any kind — see this module's
/// doc comment. `Debug` is safe to derive: `payload`'s own `Debug` renders
/// counts, never content, and deriving grants inspection, not construction.
#[derive(Debug)]
pub struct PromptSpec {
    task: &'static str,
    subject: Option<String>,
    payload: RedactedPayload,
}

impl PromptSpec {
    /// The fixed, per-feature task copy. `&'static str`, so even inside
    /// this crate there is no runtime-built value to hand back.
    pub(crate) fn task(&self) -> &'static str {
        self.task
    }

    /// The one validated caller-authored string, if this feature has one.
    /// Emitted as its own JSON leaf by `ai::http::build_body`.
    pub(crate) fn subject(&self) -> Option<&str> {
        self.subject.as_deref()
    }

    /// The redacted snippets — the only source of repo content in the
    /// outbound body.
    pub(crate) fn payload(&self) -> &RedactedPayload {
        &self.payload
    }

    /// Section 7.4's `sentFileCount` / `sentByteCount`, delegated to the
    /// wrapped payload so the number the UI shows is the post-redaction,
    /// post-cap truth rather than a separately-maintained count.
    pub fn sent_file_count(&self) -> usize {
        self.payload.sent_file_count()
    }

    pub fn sent_byte_count(&self) -> usize {
        self.payload.sent_byte_count()
    }
}

/// The only place `PromptSpec { .. }` is constructed. Takes a typed
/// feature and a `RedactedPayload`; there is no third parameter through
/// which instructions could arrive.
pub fn build(feature: AiFeature, payload: RedactedPayload) -> PromptSpec {
    let (task, subject) = match feature {
        AiFeature::ProjectSummary => (TASK_PROJECT_SUMMARY, None),
        AiFeature::ModuleExplanation(module_id) => (
            TASK_MODULE_EXPLANATION,
            Some(module_id.as_str().to_string()),
        ),
        AiFeature::Question(question) => (TASK_QUESTION, Some(question.as_str().to_string())),
        AiFeature::ConnectivityCheck => (TASK_CONNECTIVITY_CHECK, None),
    };
    PromptSpec {
        task,
        subject,
        payload,
    }
}

/// Every fixed task string, for the test-only allow-set `ai::http`'s
/// real-bytes leaf-walk uses (a leaf that is one of these is scaffolding,
/// not content) and for the "every feature asks for citations" test.
#[cfg(test)]
pub(crate) const ALL_TASK_STRINGS: &[&str] = &[
    TASK_PROJECT_SUMMARY,
    TASK_MODULE_EXPLANATION,
    TASK_QUESTION,
    TASK_CONNECTIVITY_CHECK,
];

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(entries: &[(&str, &str)]) -> RedactedPayload {
        crate::privacy::redact::redact(
            &crate::contract::EngineSnippetsResult {
                snippets: entries
                    .iter()
                    .map(|(path, content)| crate::contract::EngineSnippet {
                        path: (*path).to_string(),
                        start_line: 1,
                        end_line: 1,
                        content: (*content).to_string(),
                    })
                    .collect(),
            },
            &[],
        )
        .expect("plain non-secret content redacts cleanly")
    }

    #[test]
    fn every_feature_task_instructs_the_model_to_cite_paths_with_lines() {
        for feature in [
            AiFeature::ProjectSummary,
            AiFeature::ModuleExplanation(ModuleId::parse("src/services").unwrap()),
            AiFeature::Question(UserQuestion::parse("where is auth?").unwrap()),
        ] {
            let spec = build(feature, payload(&[("a.ts", "const a = 1;")]));
            assert!(
                spec.task().contains("path:line"),
                "task copy must ask for verifiable citations: {}",
                spec.task()
            );
        }
    }

    #[test]
    fn project_summary_has_no_subject_leaf_at_all() {
        let spec = build(
            AiFeature::ProjectSummary,
            payload(&[("a.ts", "const a = 1;")]),
        );
        assert_eq!(spec.subject(), None);
    }

    #[test]
    fn a_module_explanation_carries_the_module_id_as_its_own_subject_leaf() {
        let spec = build(
            AiFeature::ModuleExplanation(ModuleId::parse("src/services").unwrap()),
            payload(&[("a.ts", "const a = 1;")]),
        );
        assert_eq!(spec.subject(), Some("src/services"));
    }

    #[test]
    fn a_question_carries_the_users_words_verbatim_as_its_own_subject_leaf() {
        let spec = build(
            AiFeature::Question(UserQuestion::parse("where is the auth check?").unwrap()),
            payload(&[("a.ts", "const a = 1;")]),
        );
        assert_eq!(spec.subject(), Some("where is the auth check?"));
    }

    #[test]
    fn the_subject_is_never_concatenated_into_the_task_copy() {
        let spec = build(
            AiFeature::Question(UserQuestion::parse("where is the auth check?").unwrap()),
            payload(&[("a.ts", "const a = 1;")]),
        );
        assert!(
            !spec.task().contains("where is the auth check?"),
            "the question must be its own JSON leaf, never glued into the task string"
        );
    }

    #[test]
    fn a_blank_question_is_rejected() {
        assert_eq!(
            UserQuestion::parse("   ").unwrap_err().code,
            "E_INVALID_SETTINGS"
        );
    }

    #[test]
    fn an_over_long_question_is_rejected() {
        let long = "a".repeat(crate::constants::AI_QUESTION_MAX_LEN + 1);
        assert_eq!(
            UserQuestion::parse(&long).unwrap_err().code,
            "E_INVALID_SETTINGS"
        );
    }

    #[test]
    fn a_blank_or_over_long_module_id_is_rejected() {
        assert!(ModuleId::parse("").is_err());
        assert!(ModuleId::parse(&"m".repeat(crate::constants::AI_MODULE_ID_MAX_LEN + 1)).is_err());
    }

    #[test]
    fn counts_are_delegated_to_the_wrapped_redacted_payload() {
        let spec = build(
            AiFeature::ProjectSummary,
            payload(&[("a.ts", "const a = 1;"), ("b.ts", "const b = 2;")]),
        );
        assert_eq!(spec.sent_file_count(), 2);
        assert_eq!(
            spec.sent_byte_count(),
            "const a = 1;".len() + "const b = 2;".len()
        );
    }
}
