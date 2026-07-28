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
    /// The connectivity check's stand-in for `SnippetsFetched`/`Redacted`/
    /// `Capped`.
    ///
    /// It is a DISTINCT step, not a reuse of `Redacted`, because a
    /// connectivity probe carries no repo content: `run_test` builds its
    /// payload from an empty snippet set, so recording `Redacted` there
    /// would attest that redaction happened over nothing. A control that
    /// reports without holding is the defect class this pipeline exists to
    /// prevent — and the failure mode is delayed, not immediate: if someone
    /// later adds content to the probe, a `Redacted` step would keep
    /// claiming the content was redacted when nothing had re-examined it.
    ConnectivityProbeBuilt,
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

/// A connectivity check's order. Shorter than [`REQUIRED_ORDER`] because a
/// probe has no repo, no snippets and no answer to verify.
pub const CONNECTIVITY_ORDER: &[PipelineStep] = &[
    PipelineStep::PermitAcquired,
    PipelineStep::RateLimitAcquired,
    PipelineStep::ConnectivityProbeBuilt,
    PipelineStep::TranscriptRecorded,
    PipelineStep::Sent,
];

pub const CONNECTIVITY_STEPS_BEFORE_SEND: &[PipelineStep] = &[
    PipelineStep::PermitAcquired,
    PipelineStep::RateLimitAcquired,
    PipelineStep::ConnectivityProbeBuilt,
    PipelineStep::TranscriptRecorded,
];

/// Which pipeline a trace belongs to. Chosen at CONSTRUCTION and never
/// afterwards — see [`PipelineTrace`].
///
/// `pub` because [`SendApproval`] carries it and callers must be able to
/// state which kind of request they are making; the VALUE is still only ever
/// set by `PipelineTrace`'s two constructors.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TraceKind {
    Feature,
    Connectivity,
}

/// Proof that [`PipelineTrace::ensure_ready_to_send`] ran and passed, for
/// ONE request of a stated kind.
///
/// This is the H1 lesson applied to the egress door. A scanner asserting
/// "every call site carries a `PipelineTrace` parameter" would pass a
/// function that takes the parameter, records nothing and gates nothing —
/// the same error as "the virtualization library is a dependency" versus
/// "the lists are virtualized". So the guarantee is structural: the field is
/// private, there is no public constructor, and the only way to obtain one
/// is a successful `ensure_ready_to_send`.
///
/// ## Two properties the first version got wrong
///
/// **It carries its kind.** Making the two trace ORDERS disjoint at
/// validation achieves nothing if the resulting tokens are
/// interchangeable: a connectivity trace mints an approval after five steps
/// with no `Redacted` and no `Capped`, and a kind-less token would then
/// authorise a full feature payload. The approvals have to be as disjoint as
/// the traces that mint them, so [`kind`](Self::kind) is checked at the send
/// site.
///
/// **It is consumed, not borrowed.** A `&SendApproval` proves an approval
/// happened at some point, not that THIS send is approved — one mint would
/// authorise N sends, including a send issued after a later gate would have
/// refused. Taking it by value makes "one approval, one request" a borrow-
/// checker fact rather than a convention.
///
/// The minting surface is deliberately bare: no `Clone`, no `Copy`, no
/// `Default`, no `Deserialize`, and no public constructor. A single derive
/// would turn "unforgeable" into "unforgeable except by anyone who wants
/// two", which is the whole guarantee.
#[derive(Debug)]
pub struct SendApproval {
    kind: TraceKind,
}

impl SendApproval {
    /// The pipeline this approval was minted from. `ai::http::send` refuses
    /// a mismatch.
    pub fn kind(&self) -> TraceKind {
        self.kind
    }
}

/// The trace, with its required order fixed at construction.
///
/// Two orders are two grammars, and H1 showed that a fix which keeps two
/// grammars DISJOINT beats one that lets them converge. If
/// `ensure_ready_to_send` selected an order at validation time — trying the
/// feature order, falling back to the connectivity order — then a feature
/// request missing `SnippetsFetched`, `Redacted` and `Capped` would satisfy
/// the connectivity rules and send anyway. The downgrade is prevented by
/// construction: a trace is born `Feature` or `Connectivity` and is only
/// ever checked against the set it was born with. There is no fallback and
/// no runtime selection.
#[derive(Debug)]
pub struct PipelineTrace {
    kind: TraceKind,
    steps: Vec<PipelineStep>,
}

impl PipelineTrace {
    /// A full Section 12 feature request (`ai_project_summary` / `ai_explain_module` / `ai_ask`).
    pub fn new_feature() -> Self {
        PipelineTrace {
            kind: TraceKind::Feature,
            steps: Vec::new(),
        }
    }

    /// A `test_ai_key` connectivity probe.
    pub fn new_connectivity() -> Self {
        PipelineTrace {
            kind: TraceKind::Connectivity,
            steps: Vec::new(),
        }
    }

    pub(crate) fn record(&mut self, step: PipelineStep) {
        self.steps.push(step);
    }

    pub fn steps(&self) -> &[PipelineStep] {
        &self.steps
    }

    fn before_send(&self) -> &'static [PipelineStep] {
        match self.kind {
            TraceKind::Feature => STEPS_BEFORE_SEND,
            TraceKind::Connectivity => CONNECTIVITY_STEPS_BEFORE_SEND,
        }
    }

    fn full_order(&self) -> &'static [PipelineStep] {
        match self.kind {
            TraceKind::Feature => REQUIRED_ORDER,
            TraceKind::Connectivity => CONNECTIVITY_ORDER,
        }
    }

    /// The fail-closed gate: called immediately before the provider call.
    /// Refuses the request (nothing sent) if any earlier step was skipped
    /// or performed out of order. Returns the [`SendApproval`] that
    /// `ai::http::send` requires, so the gate cannot be skipped.
    pub fn ensure_ready_to_send(&self) -> Result<SendApproval, AppError> {
        self.ensure_matches(self.before_send(), "before sending")?;
        Ok(SendApproval { kind: self.kind })
    }

    /// The closing check: the whole pipeline ran, in order, before an
    /// answer is handed back to the webview.
    pub fn ensure_complete_and_ordered(&self) -> Result<(), AppError> {
        self.ensure_matches(self.full_order(), "before returning an answer")
    }

    fn ensure_matches(&self, expected: &[PipelineStep], when: &str) -> Result<(), AppError> {
        if self.steps == expected {
            return Ok(());
        }
        Err(AppError::ai_pipeline_incomplete(format!(
            "privacy pipeline check failed {when}: expected {expected:?}, ran {:?}",
            self.steps
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn trace(steps: &[PipelineStep]) -> PipelineTrace {
        let mut t = PipelineTrace::new_feature();
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
        assert!(PipelineTrace::new_feature().ensure_ready_to_send().is_err());
        assert!(PipelineTrace::new_feature()
            .ensure_complete_and_ordered()
            .is_err());
    }

    fn record_all(trace: &mut PipelineTrace, steps: &[PipelineStep]) {
        for step in steps {
            trace.record(*step);
        }
    }

    /// The connectivity order, run on a connectivity trace, passes.
    #[test]
    fn a_connectivity_run_satisfies_its_own_order() {
        let mut trace = PipelineTrace::new_connectivity();
        record_all(&mut trace, CONNECTIVITY_STEPS_BEFORE_SEND);
        assert!(trace.ensure_ready_to_send().is_ok());
        trace.record(PipelineStep::Sent);
        assert!(trace.ensure_complete_and_ordered().is_ok());
    }

    /// THE DOWNGRADE, refused by construction.
    ///
    /// This is the test that matters. A feature request that skipped
    /// `SnippetsFetched`, `Redacted` and `Capped` runs exactly the
    /// connectivity step list — so if `ensure_ready_to_send` selected an
    /// order at validation time, or fell back to the shorter one, this
    /// would pass and three privacy steps would be silently optional. The
    /// trace's kind is fixed at construction, so it is checked against the
    /// feature order and refused.
    #[test]
    fn a_feature_trace_running_only_the_connectivity_steps_is_refused() {
        let mut trace = PipelineTrace::new_feature();
        record_all(&mut trace, CONNECTIVITY_STEPS_BEFORE_SEND);
        assert!(
            trace.ensure_ready_to_send().is_err(),
            "a feature request must not be allowed to send on the connectivity order"
        );
    }

    /// The symmetric half. A redundant layer without its own test decays to
    /// one layer while looking like two, so the reverse direction is
    /// asserted as well: connectivity rules are not merely a subset that
    /// anything longer satisfies.
    #[test]
    fn a_connectivity_trace_running_the_full_feature_steps_is_refused() {
        let mut trace = PipelineTrace::new_connectivity();
        record_all(&mut trace, STEPS_BEFORE_SEND);
        assert!(
            trace.ensure_ready_to_send().is_err(),
            "a connectivity probe must not pass by running the feature order"
        );
    }

    /// An approval carries the kind that minted it, so the two token types
    /// are as disjoint as the two trace orders. Without this, a connectivity
    /// approval — minted after five steps with no `Redacted` and no
    /// `Capped` — would authorise a full feature payload, reopening at the
    /// token layer exactly the downgrade the trace kinds closed.
    #[test]
    fn an_approval_carries_the_kind_that_minted_it() {
        let mut feature = PipelineTrace::new_feature();
        record_all(&mut feature, STEPS_BEFORE_SEND);
        assert_eq!(
            feature.ensure_ready_to_send().unwrap().kind(),
            TraceKind::Feature
        );

        let mut probe = PipelineTrace::new_connectivity();
        record_all(&mut probe, CONNECTIVITY_STEPS_BEFORE_SEND);
        assert_eq!(
            probe.ensure_ready_to_send().unwrap().kind(),
            TraceKind::Connectivity
        );
    }

    /// `ConnectivityProbeBuilt` and `Redacted` are distinct values, so a
    /// probe cannot attest to a redaction that never examined any content.
    #[test]
    fn the_connectivity_order_never_claims_redaction_happened() {
        assert!(!CONNECTIVITY_ORDER.contains(&PipelineStep::Redacted));
        assert!(!CONNECTIVITY_ORDER.contains(&PipelineStep::Capped));
        assert!(!CONNECTIVITY_ORDER.contains(&PipelineStep::SnippetsFetched));
        assert!(CONNECTIVITY_ORDER.contains(&PipelineStep::ConnectivityProbeBuilt));
        assert!(!REQUIRED_ORDER.contains(&PipelineStep::ConnectivityProbeBuilt));
    }
}
