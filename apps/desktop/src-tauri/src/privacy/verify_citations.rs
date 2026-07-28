//! Section 8.10 — AI citation verification, the inbound counterpart to
//! Section 8.9's outbound redaction pass.
//!
//! ```text
//! VERIFY(answerMarkdown, indexedPaths) -> Ok(answer) | Err(E_AI_CITATION_REJECTED)
//!   1. extract candidate paths: backtick spans and markdown links matching
//!      /[\w.\-/]+\.(ts|tsx|js|jsx|mjs|cjs|py|json|md|toml|yaml|yml)(:\d+)?/
//!   2. normalize each to repo-relative POSIX
//!   3. if any candidate is NOT in indexedPaths -> reject the WHOLE answer,
//!      return the offending path in AppError.path
//!   4. rewrite each verified citation into `[[path:line]]`
//! ```
//!
//! ## Two deliberate strengthenings of the spec (both logged in `docs/DECISIONS.md`)
//!
//! **(a) Line resolution.** Step 3, taken literally, only checks path
//! MEMBERSHIP. That lets `src/services/auth.service.ts:9999` through in a
//! 40-line file: a path that genuinely is in the index, carrying a line
//! number that resolves to nothing. That is precisely the
//! plausible-but-unresolvable citation the whole feature exists to refuse —
//! a reader clicking it lands nowhere, and "Onboard never shows paths it
//! can't verify" would be false in exactly the case a user would notice.
//! [`CitationIndex`] therefore carries each file's real line count, and a
//! citation that names a line outside `1..=lineCount` is rejected
//! wholesale, same as an unknown path
//! ([`AppError::ai_citation_line_out_of_range`]). Section 8.9's redaction
//! pass is what makes this check MEANINGFUL: it preserves line counts
//! exactly, so a line number the model saw still maps to the real file.
//!
//! **(b) Non-vacuousness.** "Every citation resolves" is trivially TRUE of
//! an answer containing zero citations, so a bare reading of step 3 reports
//! a completely uncited answer as "verified". [`VerifiedAnswer`] makes that
//! state unrepresentable rather than merely tested:
//! [`VerifiedAnswer::citation_count`] returns [`NonZeroUsize`], and the only
//! constructor is [`verify_citations`] below, which builds it through
//! `NonZeroUsize::new(..).ok_or_else(..)`. There is no way to hold a
//! `VerifiedAnswer` that cites nothing — an uncited answer is an
//! `E_AI_CITATION_REJECTED` error ([`AppError::ai_answer_uncited`]), not a
//! success with an empty list.
//!
//! Both failure modes reject the WHOLE answer (step 3: "Never show a
//! partially verified answer") — the rewrite below is built into a fresh
//! buffer that is discarded entirely on the first bad citation, so there is
//! no partially-verified value for a caller to accidentally use.

use std::collections::BTreeMap;
use std::num::NonZeroUsize;

use once_cell::sync::Lazy;
use regex::Regex;

use crate::error::AppError;

/// Section 8.10 step 1's candidate pattern. The extension alternation is
/// ordered longest-first (`tsx` before `ts`, `json` before `js`) so a
/// leftmost-first engine cannot stop at the shorter prefix of a longer
/// extension; the trailing `\b` stops `.ts` from matching inside
/// `.tsconfig`. Group 1 is the optional `:line` suffix's digits.
static CITATION_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"[\w.\-/]+\.(?:tsx|jsx|json|toml|yaml|mjs|cjs|yml|ts|js|py|md)(?::(\d+))?\b")
        .expect("citation pattern must compile")
});

/// Section 8.10 step 2: repo-relative POSIX. The candidate pattern's own
/// character class admits neither backslashes nor whitespace, so this only
/// has to strip the leading `./` / `/` a model sometimes writes.
fn normalize_path(raw: &str) -> String {
    let mut path = raw.replace('\\', "/");
    while let Some(stripped) = path.strip_prefix("./") {
        path = stripped.to_string();
    }
    path.trim_start_matches('/').to_string()
}

/// What Section 8.10 step 3 checks a candidate against: every indexed path,
/// plus its real line count (strengthening (a) — see this module's doc
/// comment). Built from the analysis's own `files` list, so "indexed" means
/// exactly what the engine reported, never a second, drifting copy.
#[derive(Debug, Default)]
pub struct CitationIndex {
    line_counts: BTreeMap<String, u64>,
}

impl CitationIndex {
    pub fn from_files<I: IntoIterator<Item = (String, u64)>>(files: I) -> Self {
        CitationIndex {
            line_counts: files
                .into_iter()
                .map(|(path, line_count)| (normalize_path(&path), line_count))
                .collect(),
        }
    }

    fn line_count(&self, path: &str) -> Option<u64> {
        self.line_counts.get(path).copied()
    }
}

/// An answer every one of whose citations resolved to a real indexed path
/// AND (when it named a line) a line that file actually has. Private
/// fields, no public constructor of any kind — [`verify_citations`] is the
/// only place `VerifiedAnswer { .. }` is written, mirroring
/// `RedactedPayload`'s discipline on the outbound side.
#[derive(Debug)]
pub struct VerifiedAnswer {
    markdown: String,
    cited_paths: Vec<String>,
    citation_count: NonZeroUsize,
}

impl VerifiedAnswer {
    /// The rewritten markdown: every verified citation replaced with the
    /// `[[path:line]]` jump token the UI renders as a link (step 4).
    pub fn markdown(&self) -> &str {
        &self.markdown
    }

    /// Distinct cited paths, first-seen order — the `citedPaths` field of
    /// every `ai_*` command's response (Section 7.4).
    pub fn cited_paths(&self) -> &[String] {
        &self.cited_paths
    }

    /// Non-zero by construction: see this module's doc comment,
    /// strengthening (b).
    pub fn citation_count(&self) -> NonZeroUsize {
        self.citation_count
    }
}

/// One verified citation: an indexed path plus, optionally, a line that
/// file really has.
struct Citation {
    path: String,
    line: Option<u64>,
}

impl Citation {
    /// Section 8.10 step 4's clickable token.
    fn to_token(&self) -> String {
        match self.line {
            Some(line) => format!("[[{}:{line}]]", self.path),
            None => format!("[[{}]]", self.path),
        }
    }
}

/// Steps 2 + 3 for one regex match. Returns the offending path (or
/// `path:line`) inside the `AppError` so the UI can name it without
/// re-parsing `message` (acceptance criterion 18).
fn verify_match(
    captures: &regex::Captures<'_>,
    index: &CitationIndex,
) -> Result<Citation, AppError> {
    let whole = captures.get(0).expect("group 0 always exists");
    let line_group = captures.get(1);
    let raw_path = match line_group {
        // Trim the `:` as well as the digits.
        Some(group) => &whole.as_str()[..group.start() - whole.start() - 1],
        None => whole.as_str(),
    };
    let path = normalize_path(raw_path);

    let Some(real_line_count) = index.line_count(&path) else {
        return Err(AppError::ai_citation_rejected(&path));
    };

    let line = line_group.and_then(|group| group.as_str().parse::<u64>().ok());
    if let Some(line) = line {
        if line == 0 || line > real_line_count {
            return Err(AppError::ai_citation_line_out_of_range(
                &path,
                line,
                real_line_count,
            ));
        }
    }
    Ok(Citation { path, line })
}

/// A markdown construct Section 8.10 step 1 extracts candidates from.
/// Anything else in the answer is prose and is copied through untouched.
enum Span<'a> {
    Code(&'a str),
    Link { target: &'a str },
}

/// Parses the span starting at `tail[0]` (already known to be `` ` `` or
/// `[`). Returns the span and how many bytes it occupies; `None` means the
/// delimiter did not open a well-formed span and should be copied through
/// as a literal character.
fn parse_span(tail: &str) -> Option<(Span<'_>, usize)> {
    if let Some(after_open) = tail.strip_prefix('`') {
        let close = after_open.find('`')?;
        let content = &after_open[..close];
        if content.contains('\n') {
            return None;
        }
        return Some((Span::Code(content), 1 + close + 1));
    }

    let after_open = tail.strip_prefix('[')?;
    let close_text = after_open.find(']')?;
    let after_text = &after_open[close_text + 1..];
    let after_paren = after_text.strip_prefix('(')?;
    let close_target = after_paren.find(')')?;
    Some((
        Span::Link {
            target: &after_paren[..close_target],
        },
        1 + close_text + 1 + 1 + close_target + 1,
    ))
}

/// Accumulates verified citations while the rewrite is built, so
/// `cited_paths` stays first-seen-ordered and de-duplicated without a
/// second pass.
struct Verified {
    cited_paths: Vec<String>,
    count: usize,
}

impl Verified {
    fn record(&mut self, citation: &Citation) {
        if !self.cited_paths.iter().any(|p| p == &citation.path) {
            self.cited_paths.push(citation.path.clone());
        }
        self.count += 1;
    }
}

/// Verifies every candidate inside one span's text and rewrites that text,
/// replacing each candidate in place with its `[[path:line]]` token.
fn rewrite_candidates(
    text: &str,
    index: &CitationIndex,
    verified: &mut Verified,
) -> Result<Option<String>, AppError> {
    let mut rewritten = String::new();
    let mut last_end = 0usize;
    let mut found_any = false;

    for captures in CITATION_PATTERN.captures_iter(text) {
        let citation = verify_match(&captures, index)?;
        let whole = captures.get(0).expect("group 0 always exists");
        rewritten.push_str(&text[last_end..whole.start()]);
        rewritten.push_str(&citation.to_token());
        last_end = whole.end();
        verified.record(&citation);
        found_any = true;
    }

    if !found_any {
        return Ok(None);
    }
    rewritten.push_str(&text[last_end..]);
    Ok(Some(rewritten))
}

/// Section 8.10 `VERIFY`. Rejects the WHOLE answer on the first candidate
/// that does not resolve (unknown path OR out-of-range line), and on an
/// answer that cites nothing at all — see this module's doc comment.
pub fn verify_citations(
    answer_markdown: &str,
    index: &CitationIndex,
) -> Result<VerifiedAnswer, AppError> {
    let mut out = String::with_capacity(answer_markdown.len());
    let mut verified = Verified {
        cited_paths: Vec::new(),
        count: 0,
    };
    let mut rest = answer_markdown;

    while !rest.is_empty() {
        let Some(offset) = rest.find(['`', '[']) else {
            out.push_str(rest);
            break;
        };
        out.push_str(&rest[..offset]);
        let tail = &rest[offset..];

        let Some((span, consumed)) = parse_span(tail) else {
            let delimiter_len = tail.chars().next().expect("tail is non-empty").len_utf8();
            out.push_str(&tail[..delimiter_len]);
            rest = &tail[delimiter_len..];
            continue;
        };

        match span {
            Span::Code(content) => match rewrite_candidates(content, index, &mut verified)? {
                // A span that is exactly one citation becomes the bare
                // token; the backticks are the citation's delimiters, not
                // part of the prose.
                Some(rewritten) if rewritten.starts_with("[[") && rewritten.ends_with("]]") => {
                    out.push_str(&rewritten);
                }
                Some(rewritten) => {
                    out.push('`');
                    out.push_str(&rewritten);
                    out.push('`');
                }
                None => out.push_str(&tail[..consumed]),
            },
            Span::Link { target } => match rewrite_candidates(target, index, &mut verified)? {
                // A link whose target is a citation is replaced entirely —
                // the UI renders the token itself as the jump link, so
                // keeping the original link text around would produce two
                // competing affordances for the same destination.
                Some(rewritten) => out.push_str(&rewritten),
                None => out.push_str(&tail[..consumed]),
            },
        }
        rest = &tail[consumed..];
    }

    let citation_count =
        NonZeroUsize::new(verified.count).ok_or_else(AppError::ai_answer_uncited)?;
    Ok(VerifiedAnswer {
        markdown: out,
        cited_paths: verified.cited_paths,
        citation_count,
    })
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

    // -----------------------------------------------------------------
    // Step 6 additions
    // -----------------------------------------------------------------

    /// The exact case strengthening (a) exists for, stated as its own test:
    /// the LAST line of a file is fine, one past it is not — so the check
    /// is a real range check, not an "any line number is fine" no-op or an
    /// off-by-one that rejects legitimate final-line citations.
    #[test]
    fn the_last_real_line_is_accepted_and_one_past_it_is_not() {
        let last = verify_citations("`src/index.ts:22`", &index())
            .expect("the file's final line must verify");
        assert_eq!(last.markdown(), "[[src/index.ts:22]]");

        let past = verify_citations("`src/index.ts:23`", &index()).unwrap_err();
        assert_eq!(past.path.as_deref(), Some("src/index.ts:23"));
    }

    /// Line 0 does not exist in any file (line numbers are 1-based
    /// everywhere in the contract), so it is out of range even though it is
    /// numerically "below" the count.
    #[test]
    fn line_zero_is_out_of_range_for_every_file() {
        let err = verify_citations("`src/index.ts:0`", &index()).unwrap_err();
        assert_eq!(err.code, "E_AI_CITATION_REJECTED");
        assert_eq!(err.path.as_deref(), Some("src/index.ts:0"));
    }

    /// A citation with no line at all is still verified for path
    /// membership, and still counts toward non-vacuousness.
    #[test]
    fn a_citation_without_a_line_verifies_and_renders_a_path_only_token() {
        let verified = verify_citations("See `README.md` first.", &index()).unwrap();
        assert_eq!(verified.markdown(), "See [[README.md]] first.");
        assert_eq!(verified.citation_count().get(), 1);
    }

    /// Section 8.10 step 1 names markdown links alongside backtick spans —
    /// a model that formats its citation as a link must be verified too,
    /// not silently waved through as prose.
    #[test]
    fn a_markdown_link_target_is_a_candidate_too() {
        let verified = verify_citations("Read [the logger](src/utils/logger.ts:10).", &index())
            .expect("a link to an indexed path must verify");
        assert_eq!(verified.markdown(), "Read [[src/utils/logger.ts:10]].");

        let err = verify_citations("Read [the ghost](src/ghost.ts).", &index()).unwrap_err();
        assert_eq!(err.path.as_deref(), Some("src/ghost.ts"));
    }

    /// Step 2: a model writing `./src/index.ts` means the same file as
    /// `src/index.ts`, and must not be rejected for the prefix alone.
    #[test]
    fn a_dot_slash_prefixed_path_normalizes_to_the_indexed_one() {
        let verified = verify_citations("`./src/index.ts:3`", &index()).unwrap();
        assert_eq!(verified.markdown(), "[[src/index.ts:3]]");
        assert_eq!(verified.cited_paths(), ["src/index.ts"]);
    }

    /// Distinct paths accumulate in first-seen order and repeats collapse,
    /// while `citation_count` still counts every occurrence — the two
    /// numbers answer different questions and must not be conflated.
    #[test]
    fn cited_paths_are_deduplicated_but_citation_count_is_not() {
        let verified = verify_citations(
            "`src/index.ts:1` then `src/utils/logger.ts:2` then `src/index.ts:4`",
            &index(),
        )
        .unwrap();
        assert_eq!(
            verified.cited_paths(),
            ["src/index.ts", "src/utils/logger.ts"]
        );
        assert_eq!(verified.citation_count().get(), 3);
    }

    /// A backtick span that is code rather than a bare path keeps its
    /// backticks; the citation inside it is still verified and rewritten,
    /// so an unknown path cannot hide behind surrounding code text.
    #[test]
    fn a_citation_embedded_in_a_larger_code_span_is_still_verified() {
        let verified = verify_citations("Run `bun test src/index.ts`.", &index()).unwrap();
        assert_eq!(verified.markdown(), "Run `bun test [[src/index.ts]]`.");

        let err = verify_citations("Run `bun test src/ghost.ts`.", &index()).unwrap_err();
        assert_eq!(err.path.as_deref(), Some("src/ghost.ts"));
    }

    /// Prose mentioning a path outside any backtick span or link is not a
    /// candidate (Section 8.10 step 1 is explicit about where candidates
    /// come from) — and because it is not a candidate, it also does not
    /// count toward non-vacuousness, so such an answer is still rejected.
    #[test]
    fn an_unquoted_path_in_prose_is_not_a_candidate_and_leaves_the_answer_uncited() {
        let err =
            verify_citations("The entry point is src/index.ts, roughly.", &index()).unwrap_err();
        assert_eq!(err.code, "E_AI_CITATION_REJECTED");
        assert_eq!(err.path, None);
    }

    /// `.tsconfig` must not match the `ts` alternative, and `.json` must
    /// not be truncated to `.js` — both would fabricate a candidate path
    /// that was never cited.
    #[test]
    fn the_pattern_does_not_truncate_or_over_match_extensions() {
        let matched: Vec<&str> = CITATION_PATTERN
            .find_iter("a.tsconfig b.json c.tsx")
            .map(|m| m.as_str())
            .collect();
        assert_eq!(matched, ["b.json", "c.tsx"]);
    }

    /// The whole point of "reject the WHOLE answer": nothing partially
    /// rewritten escapes. The good citations before the bad one produce no
    /// value a caller could read.
    #[test]
    fn a_rejected_answer_yields_no_partially_rewritten_markdown() {
        let result = verify_citations("`src/index.ts:1` and `src/ghost.ts`", &index());
        assert!(
            result.is_err(),
            "a partially-verified answer must not be constructible"
        );
    }
}
