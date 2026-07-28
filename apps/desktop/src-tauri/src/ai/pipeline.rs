//! `ai/pipeline.rs` — the ordering half of Section 12's mandatory `ai_*`
//! pipeline:
//!
//! ```text
//! permit::acquire -> engine.snippets -> REDACT (8.9, incl. R3 idempotence)
//!   -> caps (R4) -> transcript (R5) -> http::send -> verify citations (8.10)
//! ```
//!
//! > "Skipping any step is a CRITICAL review finding." — Section 12
//!
//! ## Why a trace, when most of the order is already type-enforced
//!
//! Much of this chain cannot be reordered even if someone tries, because
//! each step's output is the next step's only possible input:
//! `engine.snippets` produces the only `EngineSnippetsResult`, which is the
//! only thing `privacy::redact::redact` accepts; `redact` produces the only
//! `RedactedPayload` (private field, no public constructor), which is the
//! only thing `ai::prompt::build` accepts; and `PromptSpec` (also private,
//! also no public constructor) is the only thing `ai::http::send` accepts.
//! Redaction-before-send is therefore a compile error to get wrong, not a
//! convention.
//!
//! Two steps are NOT protected that way, and they are exactly the two a
//! careless edit would drop:
//!
//! - **`permit::acquire`** — the adapter re-acquires a permit internally,
//!   so deleting the pipeline's own early gate would still compile and
//!   still send. What it would lose is Section 12's "`E_AI_DISABLED`
//!   *before any other work*": the engine would be asked for snippets, and
//!   a transcript written, for a request that was never allowed.
//! - **`transcript::record`** — R5 has no output anything downstream
//!   consumes, so removing the call compiles cleanly and the request still
//!   succeeds. The user simply loses the audit record that is the entire
//!   basis of the privacy claim.
//!
//! [`PipelineTrace`] closes both. Every step records itself as it
//! completes, and [`PipelineTrace::ensure_ready_to_send`] is called
//! immediately before the provider call: if the trace so far is not exactly
//! [`STEPS_BEFORE_SEND`], the request is refused and **nothing leaves the
//! machine**. That is a fail-closed runtime gate on every real request, not
//! a test-only assertion — a deleted step breaks the feature loudly instead
//! of silently degrading the guarantee.
//! [`PipelineTrace::ensure_complete_and_ordered`] then checks the full
//! [`REQUIRED_ORDER`] before an answer is returned, so a dropped
//! citation-verification step is caught too.

use crate::error::AppError;

/// One step of Section 12's ordered pipeline. `Redacted` and `Capped` are
/// distinct steps because Section 12 lists them separately, even though
/// `privacy::redact::redact` performs R1-R4 in one call — recording both
/// there keeps the trace a faithful transcription of the spec's list
/// rather than a paraphrase.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PipelineStep {
    PermitAcquired,
    RateLimitAcquired,
    SnippetsFetched,
    Redacted,
    Capped,
    TranscriptRecorded,
    Sent,
    CitationsVerified,
}

/// The full pipeline, in Section 12's order. `RateLimitAcquired` is the one
/// addition to the spec's list (Section 12's own `AI_MAX_REQUESTS_PER_MINUTE`
/// / `AI_MAX_CONCURRENT` have to be checked somewhere); it sits directly
/// after the permit so a throttled request does no work either.
pub const REQUIRED_ORDER: &[PipelineStep] = &[
    PipelineStep::PermitAcquired,
    PipelineStep::RateLimitAcquired,
    PipelineStep::SnippetsFetched,
    PipelineStep::Redacted,
    PipelineStep::Capped,
    PipelineStep::TranscriptRecorded,
    PipelineStep::Sent,
    PipelineStep::CitationsVerified,
];

/// Everything that must have happened before a single byte may leave.
pub const STEPS_BEFORE_SEND: &[PipelineStep] = &[
    PipelineStep::PermitAcquired,
    PipelineStep::RateLimitAcquired,
    PipelineStep::SnippetsFetched,
    PipelineStep::Redacted,
    PipelineStep::Capped,
    PipelineStep::TranscriptRecorded,
];

#[derive(Debug, Default)]
pub struct PipelineTrace(Vec<PipelineStep>);

impl PipelineTrace {
    pub fn new() -> Self {
        PipelineTrace(Vec::new())
    }

    pub(crate) fn record(&mut self, step: PipelineStep) {
        self.0.push(step);
    }

    pub fn steps(&self) -> &[PipelineStep] {
        &self.0
    }

    /// The fail-closed gate: called immediately before the provider call.
    /// Refuses the request (nothing sent) if any earlier step was skipped
    /// or performed out of order.
    pub fn ensure_ready_to_send(&self) -> Result<(), AppError> {
        self.ensure_matches(STEPS_BEFORE_SEND, "before sending")
    }

    /// The closing check: the whole pipeline ran, in order, before an
    /// answer is handed back to the webview.
    pub fn ensure_complete_and_ordered(&self) -> Result<(), AppError> {
        self.ensure_matches(REQUIRED_ORDER, "before returning an answer")
    }

    fn ensure_matches(&self, expected: &[PipelineStep], when: &str) -> Result<(), AppError> {
        if self.0 == expected {
            return Ok(());
        }
        Err(AppError::ai_pipeline_incomplete(format!(
            "privacy pipeline check failed {when}: expected {expected:?}, ran {:?}",
            self.0
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn trace(steps: &[PipelineStep]) -> PipelineTrace {
        let mut t = PipelineTrace::new();
        for step in steps {
            t.record(*step);
        }
        t
    }

    #[test]
    fn the_required_order_is_exactly_section_12s_list() {
        assert_eq!(
            REQUIRED_ORDER,
            [
                PipelineStep::PermitAcquired,
                PipelineStep::RateLimitAcquired,
                PipelineStep::SnippetsFetched,
                PipelineStep::Redacted,
                PipelineStep::Capped,
                PipelineStep::TranscriptRecorded,
                PipelineStep::Sent,
                PipelineStep::CitationsVerified,
            ]
        );
        assert_eq!(
            STEPS_BEFORE_SEND,
            &REQUIRED_ORDER[..REQUIRED_ORDER.len() - 2]
        );
    }

    #[test]
    fn a_complete_in_order_run_passes_both_gates() {
        let ready = trace(STEPS_BEFORE_SEND);
        assert!(ready.ensure_ready_to_send().is_ok());
        let full = trace(REQUIRED_ORDER);
        assert!(full.ensure_complete_and_ordered().is_ok());
    }

    /// The transcript is the step with no downstream consumer, so it is
    /// the one a refactor can silently delete — this proves the gate
    /// refuses to send when it is missing.
    #[test]
    fn a_run_missing_the_transcript_step_is_refused_before_sending() {
        let without_transcript: Vec<PipelineStep> = STEPS_BEFORE_SEND
            .iter()
            .copied()
            .filter(|s| *s != PipelineStep::TranscriptRecorded)
            .collect();
        let err = trace(&without_transcript)
            .ensure_ready_to_send()
            .expect_err("a missing R5 step must refuse the send");
        assert_eq!(err.code, "E_AI_PAYLOAD_UNSAFE");
    }

    /// Redaction happening AFTER the transcript (or after send) is a
    /// different failure from redaction not happening at all — order
    /// alone must fail the gate.
    #[test]
    fn the_right_steps_in_the_wrong_order_are_refused() {
        let reordered = [
            PipelineStep::PermitAcquired,
            PipelineStep::RateLimitAcquired,
            PipelineStep::SnippetsFetched,
            PipelineStep::TranscriptRecorded,
            PipelineStep::Redacted,
            PipelineStep::Capped,
        ];
        assert!(trace(&reordered).ensure_ready_to_send().is_err());
    }

    #[test]
    fn a_run_missing_citation_verification_never_returns_an_answer() {
        let without_verify: Vec<PipelineStep> = REQUIRED_ORDER
            .iter()
            .copied()
            .filter(|s| *s != PipelineStep::CitationsVerified)
            .collect();
        assert!(trace(&without_verify)
            .ensure_complete_and_ordered()
            .is_err());
    }

    #[test]
    fn an_empty_run_is_refused_rather_than_treated_as_trivially_fine() {
        assert!(PipelineTrace::new().ensure_ready_to_send().is_err());
        assert!(PipelineTrace::new().ensure_complete_and_ordered().is_err());
    }
}
