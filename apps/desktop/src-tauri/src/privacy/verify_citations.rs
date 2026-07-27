//! Section 8.10 — AI citation verification. RED phase: signatures only.

use std::num::NonZeroUsize;

use crate::error::AppError;

pub struct CitationIndex;

impl CitationIndex {
    pub fn from_files<I: IntoIterator<Item = (String, u64)>>(_files: I) -> Self {
        unimplemented!()
    }
}

pub struct VerifiedAnswer;

impl VerifiedAnswer {
    pub fn markdown(&self) -> &str {
        unimplemented!()
    }
    pub fn cited_paths(&self) -> &[String] {
        unimplemented!()
    }
    pub fn citation_count(&self) -> NonZeroUsize {
        unimplemented!()
    }
}

pub fn verify_citations(
    _answer_markdown: &str,
    _index: &CitationIndex,
) -> Result<VerifiedAnswer, AppError> {
    unimplemented!()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn index() -> CitationIndex {
        CitationIndex::from_files([
            ("src/services/auth.service.ts".to_string(), 40u64),
            ("src/index.ts".to_string(), 22u64),
            ("src/utils/logger.ts".to_string(), 45u64),
            ("README.md".to_string(), 62u64),
        ])
    }

    #[test]
    fn rejects_the_whole_answer_when_a_cited_path_is_not_in_the_index() {
        let answer = "The entry point is `src/does-not-exist.ts` and it wires everything up.";
        let err = verify_citations(answer, &index()).unwrap_err();
        assert_eq!(err.code, "E_AI_CITATION_REJECTED");
        assert_eq!(err.path.as_deref(), Some("src/does-not-exist.ts"));
    }

    #[test]
    fn rejects_an_indexed_path_whose_cited_line_is_out_of_range() {
        let answer = "See `src/services/auth.service.ts:9999` for the token check.";
        let err = verify_citations(answer, &index()).unwrap_err();
        assert_eq!(err.code, "E_AI_CITATION_REJECTED");
        assert_eq!(
            err.path.as_deref(),
            Some("src/services/auth.service.ts:9999")
        );
    }

    #[test]
    fn accepts_an_indexed_path_with_an_in_range_line_and_rewrites_it() {
        let answer = "See `src/services/auth.service.ts:12` for the token check.";
        let verified = verify_citations(answer, &index()).expect("expected a verified answer");
        assert!(verified.citation_count().get() > 0);
        assert_eq!(
            verified.markdown(),
            "See [[src/services/auth.service.ts:12]] for the token check."
        );
        assert_eq!(verified.cited_paths(), ["src/services/auth.service.ts"]);
    }

    #[test]
    fn an_answer_with_zero_citations_is_never_reported_as_verified() {
        let answer = "This project appears to be a web service. I cannot tell you more.";
        let err = verify_citations(answer, &index()).unwrap_err();
        assert_eq!(err.code, "E_AI_CITATION_REJECTED");
        assert_eq!(err.path, None);
    }

    #[test]
    fn one_bad_citation_among_several_good_ones_rejects_everything() {
        let answer =
            "Start at `src/index.ts:1`, then `src/utils/logger.ts:10`, then `src/ghost.ts:3`.";
        let err = verify_citations(answer, &index()).unwrap_err();
        assert_eq!(err.code, "E_AI_CITATION_REJECTED");
        assert_eq!(err.path.as_deref(), Some("src/ghost.ts"));
    }
}
