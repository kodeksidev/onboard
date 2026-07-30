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
//! **(c) The output grammar is not an input grammar** (Phase 13 finding
//! H1). `[[path:line]]` is the token step 4 EMITS and the token the UI
//! PARSES (`answer-tokens.ts`'s `INLINE_PATTERN`). Nothing, originally,
//! stopped the MODEL from writing one: `[[src/ghost.ts:1]]` is neither a
//! backtick span nor a well-formed `[text](target)` link, so [`parse_span`]
//! returned `None`, the `[` was copied through as a literal, and the token
//! reached the UI **never having been checked against the index** — with a
//! path that is legitimately cited elsewhere it even passed the UI's
//! `citedPaths` gate and rendered as a real, clickable link to a line the
//! file does not have. Step 3's whole-answer rejection was evadable purely
//! by choice of delimiter.
//!
//! The fix is *not* to verify such a token (that would make the verifier's
//! output indistinguishable from its input by design) and *not* to
//! neutralise it (that still SHOWS the user a path nothing verified, which
//! is what step 3 exists to prevent). It is to keep the two grammars
//! **disjoint**: a token in the verifier's output grammar is illegitimate
//! anywhere in the RAW answer, so [`reject_forged_tokens`] refuses the
//! whole answer before any rewriting
//! ([`AppError::ai_citation_token_forged`]). The model is asked for
//! backticked `path:line` citations (`ai::prompt`'s task strings), so no
//! legitimate answer contains one.
//!
//! That gives the property the rest of the pipeline can rely on:
//!
//! > **Every `[[…]]` token in the answer this function returns was written
//! > by this function, after verifying it against the index.**
//!
//! It is enforced twice, on purpose. `reject_forged_tokens` is the rule;
//! [`ensure_every_token_was_emitted`] re-derives the property from the
//! FINISHED buffer and fails closed if it does not hold, so a future edit
//! to the scanning loop cannot quietly reopen the hole — it has to defeat a
//! post-condition stated in terms of the invariant itself, not in terms of
//! any particular parsing step. Both the rule and the post-condition share
//! one recogniser ([`parse_output_token`]) whose acceptance set is a
//! superset of what [`Citation::to_token`] emits AND of what the UI
//! linkifies, so neither grammar can drift out from under it.
//!
//! Both failure modes reject the WHOLE answer (step 3: "Never show a
//! partially verified answer") — the rewrite below is built into a fresh
//! buffer that is discarded entirely on the first bad citation, so there is
//! no partially-verified value for a caller to accidentally use.

use std::collections::{BTreeMap, BTreeSet};
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
    /// The inside of Section 8.10 step 4's token — `path` or `path:line`.
    /// Kept separate from [`Citation::to_token`] so the emitted text and
    /// the text remembered for [`ensure_every_token_was_emitted`] cannot
    /// drift apart: there is exactly one place either is spelled.
    fn token_inner(&self) -> String {
        match self.line {
            Some(line) => format!("{}:{line}", self.path),
            None => self.path.clone(),
        }
    }

    /// Section 8.10 step 4's clickable token.
    fn to_token(&self) -> String {
        format!("[[{}]]", self.token_inner())
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

    // `.ok()` here was a fail-open on the citation boundary. The regex captures
    // `(\d+)`, so `parse::<u64>` fails ONLY on overflow — a digit run longer
    // than u64 can hold. That collapsed to `None`, which skipped the range
    // check below entirely, and `src/index.ts:99999999999999999999999` was
    // accepted as a citation to `src/index.ts` with no line at all. The line
    // number was in the model's output, was matched, and then silently vanished
    // — the INV-3 shape, on the check that exists to stop an unresolvable
    // citation reaching the user.
    //
    // A number too large for u64 is, by definition, larger than any real line
    // count, so it takes the same refusal as any other out-of-range line.
    let line = match line_group {
        None => None,
        Some(group) => match group.as_str().parse::<u64>() {
            Ok(parsed) => Some(parsed),
            Err(_) => {
                return Err(AppError::ai_citation_line_out_of_range_text(
                    &path,
                    group.as_str(),
                    real_line_count,
                ))
            }
        },
    };
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

/// Recognises the `[[…]]` token grammar at `tail[0..]`, returning the
/// token's inner text and its byte length. Strengthening (c)'s single
/// recogniser, used for BOTH the model-authored-token rule and the
/// post-condition, so the two can never disagree about what a token is.
///
/// Deliberately **wider** than either grammar it has to dominate:
///
/// - wider than [`Citation::to_token`] (which only ever emits an indexed
///   path, optionally `:line`), so a token this module could never produce
///   is still recognised as one;
/// - wider than the UI's `\[\[([^\s[\]:]+):(\d+)\]\]`, so a forgery the UI
///   would linkify — `[[src/ghost.txt:1]]`, whose extension is not even a
///   Section 8.10 candidate — cannot slip through by using a shape this
///   module happens not to emit.
///
/// The only things excluded are inner texts containing whitespace or a
/// bracket, which neither grammar can express — that is precisely what
/// keeps ordinary prose such as `[[1, 2], [3, 4]]` or a wiki-style
/// `[[Getting Started]]` out of scope, since neither is a citation claim.
fn parse_output_token(tail: &str) -> Option<(&str, usize)> {
    let after_open = tail.strip_prefix("[[")?;
    let close = after_open.find("]]")?;
    let inner = &after_open[..close];
    if inner.is_empty()
        || inner
            .chars()
            .any(|c| c.is_whitespace() || c == '[' || c == ']')
    {
        return None;
    }
    Some((inner, "[[".len() + close + "]]".len()))
}

/// Calls `on_token` for each `[[…]]` token in `text`, left to right.
/// A `[[` that does not open a token is skipped one byte at a time (it is
/// ASCII, so the offset stays on a char boundary) — `[[[x:1]]]` therefore
/// still yields the real token nested inside it.
fn for_each_output_token<E>(
    text: &str,
    mut on_token: impl FnMut(&str) -> Result<(), E>,
) -> Result<(), E> {
    let mut rest = text;
    while let Some(offset) = rest.find("[[") {
        let tail = &rest[offset..];
        match parse_output_token(tail) {
            Some((inner, consumed)) => {
                on_token(inner)?;
                rest = &tail[consumed..];
            }
            None => rest = &tail["[".len()..],
        }
    }
    Ok(())
}

/// Strengthening (c), the rule: the raw answer may not contain a token in
/// this module's own output grammar. Runs before any rewriting, so a
/// forgery is refused rather than copied through — see this module's doc
/// comment for why rejecting beats verifying or neutralising.
fn reject_forged_tokens(answer_markdown: &str) -> Result<(), AppError> {
    for_each_output_token(answer_markdown, |inner| {
        Err(AppError::ai_citation_token_forged(inner))
    })
}

/// Strengthening (c), the post-condition: every token in the FINISHED
/// buffer must be one this run actually emitted. Stated over the output
/// rather than over any parsing step, so it keeps holding no matter how the
/// scanning loop is later rewritten; fails closed if it ever does not.
fn ensure_every_token_was_emitted(
    output: &str,
    emitted: &BTreeSet<String>,
) -> Result<(), AppError> {
    for_each_output_token(output, |inner| {
        if emitted.contains(inner) {
            Ok(())
        } else {
            Err(AppError::ai_citation_token_forged(inner))
        }
    })
}

/// Accumulates verified citations while the rewrite is built, so
/// `cited_paths` stays first-seen-ordered and de-duplicated without a
/// second pass.
struct Verified {
    cited_paths: Vec<String>,
    emitted_tokens: BTreeSet<String>,
    count: usize,
}

impl Verified {
    fn record(&mut self, citation: &Citation) {
        if !self.cited_paths.iter().any(|p| p == &citation.path) {
            self.cited_paths.push(citation.path.clone());
        }
        self.emitted_tokens.insert(citation.token_inner());
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
/// that does not resolve (unknown path OR out-of-range line), on an answer
/// that writes this module's own `[[…]]` token itself, and on an answer
/// that cites nothing at all — see this module's doc comment.
pub fn verify_citations(
    answer_markdown: &str,
    index: &CitationIndex,
) -> Result<VerifiedAnswer, AppError> {
    reject_forged_tokens(answer_markdown)?;

    let mut out = String::with_capacity(answer_markdown.len());
    let mut verified = Verified {
        cited_paths: Vec::new(),
        emitted_tokens: BTreeSet::new(),
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
    ensure_every_token_was_emitted(&out, &verified.emitted_tokens)?;
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

    /// The fail-open the guard-disposition sweep found. The citation regex
    /// captures `(\d+)`, so a digit run too long for `u64` still MATCHES and
    /// then fails to parse. That used to collapse to `None` via `.ok()`, which
    /// skipped the range check entirely: the citation was accepted, the line
    /// number silently dropped, and the user was shown a resolved-looking
    /// reference to a line nobody had checked.
    ///
    /// This is the INV-3 shape — drop the part that failed validation, return
    /// the rest, tell nobody — on the check that exists to stop an
    /// unresolvable citation reaching the user.
    #[test]
    fn rejects_a_cited_line_number_too_large_to_parse() {
        let answer = "See `src/index.ts:99999999999999999999999` for the setup.";

        let err = verify_citations(answer, &index()).unwrap_err();

        assert_eq!(err.code, "E_AI_CITATION_REJECTED");
        // The refusal names what the model actually wrote, not a substitute.
        assert_eq!(
            err.path.as_deref(),
            Some("src/index.ts:99999999999999999999999")
        );
    }

    /// Non-vacuity for the test above: an ordinary in-range citation on the
    /// same path must still pass, so the fix refuses overflow rather than
    /// refusing line numbers.
    #[test]
    fn still_accepts_an_in_range_line_on_the_same_path() {
        let answer = "See `src/index.ts:22` for the setup.";

        assert!(verify_citations(answer, &index()).is_ok());
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

    /// Phase 13 finding H1. `[[path:line]]` is this module's OUTPUT grammar
    /// and the UI's input grammar: `AnswerMarkdown` treats it as a citation.
    /// But `parse_span` only recognises backtick spans and `[text](target)`
    /// links, so a `[[…]]` the MODEL wrote is neither, falls through
    /// `parse_span`'s `None` branch, and is copied into the answer verbatim
    /// — never checked against the index. The whole-answer rejection in 8.10
    /// step 3 was therefore evadable by choosing a different delimiter.
    ///
    /// Every earlier test here feeds the verifier backticked or linked input,
    /// so none of them could catch this: the control was real, its tests were
    /// vacuous with respect to this input shape.
    #[test]
    fn a_model_authored_double_bracket_token_for_an_unknown_path_is_rejected() {
        let answer = "Start at `src/index.ts:1`. Also see [[src/ghost.ts:1]].";
        let err = verify_citations(answer, &index()).unwrap_err();
        assert_eq!(err.code, "E_AI_CITATION_REJECTED");
    }

    /// The more dangerous half of H1: the path IS in the index, so the UI's
    /// `citedPaths` membership check passes and the token renders as a real,
    /// clickable `CitationLink` — pointing at a line that does not exist.
    /// This is exactly the "plausible citation that resolves to nothing" the
    /// line-range strengthening exists to stop, smuggled past it.
    #[test]
    fn a_model_authored_double_bracket_token_cannot_smuggle_an_out_of_range_line() {
        let answer = "Start at `src/index.ts:1`. Also see [[src/index.ts:9999]].";
        let err = verify_citations(answer, &index()).unwrap_err();
        assert_eq!(err.code, "E_AI_CITATION_REJECTED");
    }

    /// The fix must not be "ban `[[` anywhere", which would break ordinary
    /// prose. A `[[` that is not a well-formed `path:line` token carries no
    /// citation claim and must survive.
    #[test]
    fn a_double_bracket_that_is_not_a_citation_token_is_left_alone() {
        let answer = "See `src/index.ts:1`. The array literal [[1, 2], [3, 4]] is fine.";
        let verified = verify_citations(answer, &index()).expect("prose must not be rejected");
        assert!(verified.markdown().contains("[[1, 2], [3, 4]]"));
    }

    // -----------------------------------------------------------------
    // Phase 13 H1 — the rest of strengthening (c)
    // -----------------------------------------------------------------

    /// The rule is stated over the TOKEN grammar, not over the candidate
    /// grammar. `.txt` is not a Section 8.10 extension, so this forgery is
    /// invisible to `CITATION_PATTERN` — but it is a perfectly good token
    /// as far as the UI's `\[\[([^\s[\]:]+):(\d+)\]\]` is concerned. A
    /// candidate-based rule would have let it through.
    #[test]
    fn a_forged_token_is_rejected_even_when_its_path_is_not_a_candidate() {
        let answer = "Start at `src/index.ts:1`. Also see [[src/ghost.txt:1]].";
        let err = verify_citations(answer, &index()).unwrap_err();
        assert_eq!(err.code, "E_AI_CITATION_REJECTED");
    }

    /// The path-only form is emitted by `Citation::to_token` too, so it is
    /// equally part of the output grammar and equally forgeable.
    #[test]
    fn a_forged_path_only_token_is_rejected() {
        let err =
            verify_citations("Read `README.md`, then [[src/index.ts]].", &index()).unwrap_err();
        assert_eq!(err.code, "E_AI_CITATION_REJECTED");
    }

    /// Backticks do not launder a forgery: the rule runs over the RAW
    /// answer, before any span parsing decides what to look inside.
    #[test]
    fn a_forged_token_inside_a_backtick_span_is_rejected_too() {
        let err = verify_citations(
            "Cite like `[[src/ghost.txt:4]]`, e.g. `README.md`.",
            &index(),
        )
        .unwrap_err();
        assert_eq!(err.code, "E_AI_CITATION_REJECTED");
    }

    /// A forgery is refused even when everything it claims is TRUE. The
    /// point is not that the claim is false — it is that this function did
    /// not make it, and downstream nothing can tell the difference. Keeping
    /// the two grammars disjoint is what makes the invariant checkable at
    /// all.
    #[test]
    fn a_forged_token_is_rejected_even_when_its_path_and_line_would_verify() {
        let err =
            verify_citations("See `README.md` and [[src/index.ts:5]].", &index()).unwrap_err();
        assert_eq!(err.code, "E_AI_CITATION_REJECTED");
        assert_eq!(err.path, None, "the UI must fall back to `message` here");
    }

    /// Bracketed prose that carries no citation claim survives — the
    /// companion of `a_double_bracket_that_is_not_a_citation_token_is_left_
    /// alone`, for the wiki-link shape rather than the array-literal one.
    #[test]
    fn a_double_bracketed_phrase_containing_a_space_is_not_a_token() {
        let verified =
            verify_citations("See `README.md`, section [[Getting Started]].", &index()).unwrap();
        assert!(verified.markdown().contains("[[Getting Started]]"));
    }

    /// The recogniser both halves of strengthening (c) share must accept
    /// everything `Citation::to_token` can produce, or the post-condition
    /// would be checking a different language than the one being emitted.
    #[test]
    fn the_recogniser_accepts_every_shape_this_module_emits() {
        for citation in [
            Citation {
                path: "src/index.ts".to_string(),
                line: Some(1),
            },
            Citation {
                path: "README.md".to_string(),
                line: None,
            },
        ] {
            let token = citation.to_token();
            let (inner, consumed) = parse_output_token(&token)
                .unwrap_or_else(|| panic!("{token} must be recognised as a token"));
            assert_eq!(inner, citation.token_inner());
            assert_eq!(consumed, token.len());
        }
    }

    /// The RULE, exercised directly — the mirror of the post-condition test
    /// below, and it exists for the same reason stated in reverse.
    ///
    /// Strengthening (c) is enforced twice, and a mutation probe showed the
    /// two layers are independently sufficient: disabling
    /// `reject_forged_tokens` left all 27 tests in this module GREEN, because
    /// `ensure_every_token_was_emitted` caught every forgery on its own. That
    /// is the redundancy working as designed, but it also meant deleting the
    /// rule outright would have failed nothing — the post-condition had a
    /// direct test and the rule did not. Redundant layers each need their own
    /// test, or the redundancy silently decays to a single layer.
    #[test]
    fn the_rule_rejects_a_forged_token_before_any_rewriting() {
        let err = reject_forged_tokens("prose [[src/ghost.ts:9]] more").unwrap_err();
        assert_eq!(err.code, "E_AI_CITATION_REJECTED");
        // ...and leaves non-citation bracket prose alone, so the rule cannot
        // be satisfied by simply rejecting everything.
        assert!(reject_forged_tokens("array [[1, 2], [3, 4]] here").is_ok());
        assert!(reject_forged_tokens("no brackets at all").is_ok());
    }

    /// The post-condition, exercised directly with a hand-built buffer —
    /// the same discipline `redact.rs` applies to R3's `ensure_idempotent`.
    /// `reject_forged_tokens` means the real pipeline should never reach
    /// this branch, so proving the branch works cannot be left to the
    /// end-to-end tests: they would pass with the check deleted.
    #[test]
    fn the_post_condition_rejects_a_token_the_run_did_not_emit() {
        let emitted = BTreeSet::from(["src/index.ts:1".to_string()]);
        let err = ensure_every_token_was_emitted(
            "ok [[src/index.ts:1]] bad [[src/ghost.ts:9]]",
            &emitted,
        )
        .unwrap_err();
        assert_eq!(err.code, "E_AI_CITATION_REJECTED");
    }

    /// ...and accepts the buffer the real rewrite produces, including a
    /// token nested inside brackets the model wrote around it (a markdown
    /// link whose text is a backticked citation yields `[[[path:line]]]`),
    /// so the post-condition cannot be satisfied by simply never matching.
    #[test]
    fn the_post_condition_accepts_emitted_tokens_however_they_are_nested() {
        let emitted = BTreeSet::from(["src/index.ts:1".to_string()]);
        assert!(ensure_every_token_was_emitted("[[[src/index.ts:1]]]", &emitted).is_ok());
        assert!(ensure_every_token_was_emitted("no tokens at all", &emitted).is_ok());
        assert!(ensure_every_token_was_emitted("[[1, 2], [3, 4]]", &emitted).is_ok());
    }

    /// The end-to-end statement of the invariant: for a battery of accepted
    /// answers, every token in the returned markdown names a path in
    /// `citedPaths`, and every line it names is inside that file's real
    /// range. Nothing in the output is a token the index cannot back.
    #[test]
    fn every_token_in_an_accepted_answer_resolves_against_the_index() {
        let index = index();
        for answer in [
            "See `src/index.ts:22` and [the logger](src/utils/logger.ts:10).",
            "Run `bun test src/index.ts`, then read `README.md`.",
            "`./src/services/auth.service.ts:40` — the array [[1, 2], [3, 4]] is prose.",
        ] {
            let verified = verify_citations(answer, &index).expect(answer);
            for_each_output_token::<()>(verified.markdown(), |inner| {
                let (path, line) = match inner.split_once(':') {
                    Some((path, line)) => (path, Some(line.parse::<u64>().expect("digits"))),
                    None => (inner, None),
                };
                assert!(
                    verified.cited_paths().iter().any(|p| p == path),
                    "{answer}: {inner} is not in citedPaths"
                );
                let real = index.line_count(path).expect("cited path must be indexed");
                if let Some(line) = line {
                    assert!(line >= 1 && line <= real, "{answer}: {inner} out of range");
                }
                Ok(())
            })
            .expect("the closure never returns Err");
        }
    }
}
