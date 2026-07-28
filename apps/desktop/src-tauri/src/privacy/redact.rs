//! Section 8.9 — the redaction pass. Runs before **any** outbound byte
//! (Phase 12 step 2's `ai::http`, not written yet, will be the only other
//! module that ever touches a [`RedactedPayload`]).
//!
//! ## The compile-time guarantee, precisely
//!
//! [`RedactedPayload`] has one field, `files: Vec<Snippet>`, and it is
//! **private**. There is no `pub fn new`, no `Default`, no
//! `serde::Deserialize`, no `From<String>`/`From<&str>` — grep this file:
//! the only place the struct-literal `RedactedPayload { .. }` appears is
//! inside [`redact`], below, in this same module. Rust's module-privacy
//! rules mean a private field is visible only within its defining module
//! and that module's descendants (nested `mod` blocks, including this
//! file's own `#[cfg(test)] mod tests`) — never from a sibling module like
//! `privacy::caps`, and never from another crate. `tests/redaction_compile_fail.rs`
//! proves this by actually trying (and failing) from an external crate.
//!
//! [`Snippet`] (what [`redact`] builds internally before it becomes a
//! `RedactedPayload`) is likewise private-fielded with its only constructor,
//! `Snippet::from_engine`, defined right here. It deliberately does **not**
//! implement `Deserialize` — unlike [`crate::contract::EngineSnippet`] (the
//! wire DTO `engine.snippets`' RPC response actually deserializes into),
//! deriving `Deserialize` on a type make it constructible from **arbitrary
//! JSON by any module**, regardless of field privacy: serde's derive macro
//! generates its `deserialize` implementation in the type's own defining
//! module (exactly like hand-written code there would be), and that
//! generated `impl Deserialize for X` is itself a *public* trait impl
//! callable via `serde_json::from_str::<X>(..)` from anywhere. That is
//! precisely why `RedactedPayload` must never derive it either.
//!
//! ## What this does *not* (and structurally cannot) guarantee
//!
//! `EngineSnippet`'s fields are public (required for its `Deserialize`
//! derive to work at all — see above), so nothing stops another module in
//! *this same crate* from hand-constructing an `EngineSnippet` with
//! `content` set to an entire file and passing it to `redact()`. Rust's
//! module system cannot forbid that without a much heavier design (there is
//! no way to make a type "deserializable from the wire, but not
//! constructible by sibling code in the same crate"). What IS true:
//!
//! 1. There is no path from `&str`/`String`/`std::fs::read*` to `Snippet`
//!    or `RedactedPayload` anywhere in this crate — reaching either
//!    requires deliberately fabricating a fake `engine.snippets` RPC
//!    response shape, not merely reading a file and calling a function.
//!    That is exactly the difference between "rejected by construction"
//!    and "rejected by a runtime check someone can forget": there is no
//!    convenience function that takes raw text at all.
//! 2. Even a deliberately fabricated oversized/whole-file `EngineSnippet`
//!    still goes through R1-R4 unconditionally inside `redact()` — the
//!    per-file cap (R4) truncates it, and R1/R2/R3 still scan and can
//!    reject it (`E_AI_PAYLOAD_UNSAFE`) regardless of how it arrived.
//! 3. This residual gap (a determined, same-crate contributor deliberately
//!    faking RPC-shaped input) is a code-review problem, not a type-system
//!    one — consistent with Section 12's threat model being "accidental
//!    data exfiltration," not "malicious insider with commit access."

use std::fmt;

use crate::constants::{
    AI_MAX_BYTES_PER_FILE, AI_MAX_FILES, AI_MAX_LINES_PER_FILE, AI_MAX_TOTAL_BYTES,
};
use crate::contract::{EngineSnippet, EngineSnippetsResult};
use crate::error::AppError;
use crate::privacy::{caps, patterns};

/// One snippet en route to becoming part of a [`RedactedPayload`]. Private
/// fields; the only constructor is [`Snippet::from_engine`], defined here.
/// Deliberately does not derive/implement `Deserialize`, `Default`, or
/// `Clone` beyond what this module needs internally.
pub struct Snippet {
    path: String,
    start_line: u32,
    end_line: u32,
    content: String,
}

impl Snippet {
    /// The only legitimate construction path: from one element of a real
    /// `engine.snippets` RPC response (Section 7.3). See this module's doc
    /// comment for exactly what that guarantee does and does not cover.
    fn from_engine(raw: &EngineSnippet) -> Self {
        Snippet {
            path: raw.path.clone(),
            start_line: raw.start_line,
            end_line: raw.end_line,
            content: raw.content.clone(),
        }
    }

    fn content_str(&self) -> &str {
        &self.content
    }

    fn set_content(&mut self, content: String) {
        self.content = content;
    }
}

impl fmt::Debug for Snippet {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Snippet")
            .field("path", &self.path)
            .field("start_line", &self.start_line)
            .field("end_line", &self.end_line)
            .field("content", &"<redacted>")
            .finish()
    }
}

/// The final, safe-to-send payload — see this module's doc comment for the
/// full construction-guarantee writeup. Private field, no public
/// constructor of any kind.
pub struct RedactedPayload {
    files: Vec<Snippet>,
}

/// Plain, owned data `ai::http` (Phase 12 step 2) can serialize into a
/// provider request body — the minimum accessor `RedactedPayload` exposes.
/// Public and freely constructible, but that is harmless: nothing in this
/// crate converts a `RequestSnippet` (or any collection of them) back into
/// a `RedactedPayload` — there is no `From`/`TryFrom` impl in either
/// direction, so holding these grants no way to fabricate a new payload.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestSnippet {
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub content: String,
}

impl RedactedPayload {
    pub fn sent_file_count(&self) -> usize {
        self.files.len()
    }

    pub fn sent_byte_count(&self) -> usize {
        self.files.iter().map(|f| f.content.len()).sum()
    }

    /// The only way another module can obtain the redacted bytes to send.
    pub fn to_request_snippets(&self) -> Vec<RequestSnippet> {
        self.files
            .iter()
            .map(|f| RequestSnippet {
                path: f.path.clone(),
                start_line: f.start_line,
                end_line: f.end_line,
                content: f.content.clone(),
            })
            .collect()
    }
}

impl fmt::Debug for RedactedPayload {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RedactedPayload")
            .field("file_count", &self.sent_file_count())
            .field("byte_count", &self.sent_byte_count())
            .finish()
    }
}

impl fmt::Display for RedactedPayload {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "<redacted payload: {} file(s), {} byte(s)>",
            self.sent_file_count(),
            self.sent_byte_count()
        )
    }
}

/// Section 8.9 R2, rules 1 (PEM blocks, multi-line) through 12
/// (high-entropy literal), applied in the fixed order given. Splitting on
/// `'\n'` (not `.lines()`) and rejoining with `'\n'` guarantees the same
/// number of line-segments in and out — the property the AI citation
/// feature depends on (a cited line number must still map to the real
/// file) — since every rule replaces line CONTENT, never a newline itself.
fn apply_r2_pipeline(content: &str) -> String {
    let lines: Vec<&str> = content.split('\n').collect();
    let after_pem = patterns::redact_pem_blocks(&lines);
    after_pem
        .iter()
        .map(|line| patterns::apply_single_line_rules(line))
        .collect::<Vec<_>>()
        .join("\n")
}

/// R3: "re-run R2 on the output; if ANY rule still matches, abort the
/// entire request with `E_AI_PAYLOAD_UNSAFE`." Extracted as its own pure
/// function (over the two already-computed strings, rather than
/// recomputing them) so the abort branch itself is directly unit-testable
/// with synthetic inputs — the actual 12 rules are specifically designed so
/// that a genuine non-idempotent case is vanishingly hard to construct
/// (every rule's replacement is the short, fixed, low-entropy
/// `<redacted>` placeholder, which cannot itself create a new match — see
/// `patterns::REDACTED_PLACEHOLDER`'s doc comment and this module's
/// property test), so this function's own correctness is what is actually
/// exercised by a natural corpus, while its logic is proven directly here.
fn ensure_idempotent(once: &str, twice: &str) -> Result<(), AppError> {
    if once == twice {
        Ok(())
    } else {
        Err(AppError::ai_payload_unsafe())
    }
}

/// Section 8.9: `REDACT(snippets) -> RedactedSnippets | Err(E_AI_PAYLOAD_UNSAFE)`.
///
/// `input` is exactly `engine.snippets`' RPC response shape (Section
/// 7.3) — never a bare `String`. `input.snippets` is assumed already
/// ranked by the caller (search score desc, then path asc, per R4);
/// `EngineSnippet` carries no score field, so this function cannot re-rank.
pub fn redact(
    input: &EngineSnippetsResult,
    user_exclude_globs: &[String],
) -> Result<RedactedPayload, AppError> {
    let mut candidates: Vec<Snippet> = Vec::new();

    for raw in &input.snippets {
        // R1: whole-file exclusion, never sent at all.
        if patterns::is_excluded_file(&raw.path, user_exclude_globs) {
            continue;
        }

        let mut snippet = Snippet::from_engine(raw);

        // R2, then R3: re-run R2 on its own output; anything that still
        // matches means a real secret survived one pass — abort the whole
        // request rather than send a partially-redacted payload.
        let once = apply_r2_pipeline(snippet.content_str());
        let twice = apply_r2_pipeline(&once);
        ensure_idempotent(&once, &twice)?;
        snippet.set_content(once);
        candidates.push(snippet);
    }

    // R4, per-file: truncate before the aggregate cap so the aggregate
    // byte budget is spent on what will actually be sent.
    for snippet in &mut candidates {
        let truncated = caps::truncate_content(
            snippet.content_str(),
            AI_MAX_LINES_PER_FILE,
            AI_MAX_BYTES_PER_FILE,
        );
        snippet.set_content(truncated);
    }

    // R4, aggregate: keep highest-ranked files first, drop the tail.
    let byte_lens: Vec<usize> = candidates.iter().map(|s| s.content_str().len()).collect();
    let keep_count = caps::select_count_within_budget(&byte_lens, AI_MAX_FILES, AI_MAX_TOTAL_BYTES);
    candidates.truncate(keep_count);

    Ok(RedactedPayload { files: candidates })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::EngineSnippet;

    fn snippets_result(entries: &[(&str, &str)]) -> EngineSnippetsResult {
        EngineSnippetsResult {
            snippets: entries
                .iter()
                .map(|(path, content)| EngineSnippet {
                    path: (*path).to_string(),
                    start_line: 1,
                    end_line: content.matches('\n').count() as u32 + 1,
                    content: (*content).to_string(),
                })
                .collect(),
        }
    }

    // -----------------------------------------------------------------
    // Redaction corpus: >=30 planted secrets (at least one per R2 rule)
    // -----------------------------------------------------------------

    /// The corpus. Credential-shaped entries come from
    /// `privacy::fake_secrets`, the one place such strings are assembled —
    /// see that module for why no contiguous literal appears in any source
    /// file. Entries that are not credential-shaped (connection strings,
    /// assignment heuristics, entropy blobs, auth headers, hex blobs, PEM
    /// bodies) stay literal: no scanner matches them, so splitting would be
    /// indirection for nothing.
    fn planted_credential_secrets() -> Vec<(&'static str, String)> {
        use crate::privacy::fake_secrets as fake;
        vec![
            // Rule 2 — AWS access key id
            (
                "aws1",
                format!("aws_access_key_id = {}", fake::aws_example_key_id()),
            ),
            (
                "aws2",
                format!("export AWS_KEY={}", fake::aws_synthetic_key_id()),
            ),
            (
                "aws3",
                format!("// {} leaked in a comment", fake::aws_comment_key_id()),
            ),
            // Rule 3 — GitHub token
            ("gh1", fake::github_pat()),
            ("gh2", format!("token: {}", fake::github_server_token())),
            ("gh3", format!("GH_TOKEN={}", fake::github_pat_upper())),
            // Rule 4 — Slack token
            ("slack1", fake::slack_bot_token()),
            (
                "slack2",
                format!("SLACK_TOKEN={}", fake::slack_user_token()),
            ),
            ("slack3", fake::slack_app_token()),
        ]
    }

    /// Rules 5-9 (Stripe onward). Split purely for the 49-line function cap.
    fn planted_credential_secrets_b() -> Vec<(&'static str, String)> {
        use crate::privacy::fake_secrets as fake;
        vec![
            // Rule 5 — Stripe live key
            ("stripe1", fake::stripe_secret_key()),
            (
                "stripe2",
                format!("STRIPE_KEY={}", fake::stripe_restricted_key()),
            ),
            ("stripe3", fake::stripe_publishable_key()),
            // Rule 6 — Google API key (exactly 35 chars after AIza)
            ("google1", fake::google_api_key()),
            (
                "google2",
                format!("GOOGLE_API_KEY={}", fake::google_api_key_repeated()),
            ),
            // Rule 7 — OpenAI key
            ("openai1", fake::openai_key()),
            (
                "openai2",
                format!("OPENAI_API_KEY={}", fake::openai_key_upper()),
            ),
            // Rule 8 — Anthropic key
            ("anthropic1", fake::anthropic_key()),
            (
                "anthropic2",
                format!("ANTHROPIC_API_KEY={}", fake::anthropic_key_upper()),
            ),
            // Rule 9 — JWT
            ("jwt1", fake::jwt_hs256()),
            (
                "jwt2",
                format!("Authorization: Bearer {}", fake::jwt_hs256_with_typ()),
            ),
        ]
    }

    /// Rules 10-15: entries that are NOT credential-shaped, so no scanner
    /// matches them and none needs splitting. Split from the
    /// credential-shaped half only to stay under the 49-line function cap.
    fn planted_non_credential_secrets() -> Vec<(&'static str, String)> {
        vec![
            // Rule 10 — connection string (userinfo only)
            (
                "conn1",
                "DATABASE_URL=postgres://admin:hunter2@db.internal:5432/app".to_string(),
            ),
            (
                "conn2",
                "mongodb://root:s3cr3tPass@cluster0.example.net:27017/app".to_string(),
            ),
            (
                "conn3",
                "mysql://svc_user:p@ssw0rd@10.0.0.5:3306/prod".to_string(),
            ),
        ]
    }

    /// Rules 11-15 (assignment heuristic onward). Split purely for the
    /// 49-line function cap.
    fn planted_heuristic_secrets() -> Vec<(&'static str, String)> {
        vec![
            // Rule 11 — assignment heuristic
            ("assign1", r#"API_KEY="abcdefgh12345678""#.to_string()),
            ("assign2", "password: 'SuperSecretValue1'".to_string()),
            ("assign3", "auth_token = zzzzzzzzzzzzzzzz".to_string()),
            ("assign4", "MY_SECRET=qwertyuiop1234".to_string()),
            // Rule 12 — high-entropy quoted literal (>=24 chars, >=3 classes, >=4.0 bits/char)
            (
                "entropy1",
                r#"const token = "aB3$kL9!pQ2&mZ7@wR4^tY1*";"#.to_string(),
            ),
            (
                "entropy2",
                r#"apiSecret = 'zQ9#vX2$mK7!pL4&nR8^wT3@';"#.to_string(),
            ),
            (
                "entropy3",
                r#"const blob = "Xk2$Qw9!Zp4&Rt7@Lm3^Vn8*Bh1";"#.to_string(),
            ),
            // Rule 12, backtick delimiter — Phase 13 M4. `blob`, not `token`:
            // a KEY/TOKEN-ish name would be caught by rule 11 first and this
            // entry would pass without rule 12 ever seeing a template literal.
            (
                "entropy4",
                "const blob = `Xk2$Qw9!Zp4&Rt7@Lm3^Vn8*Bh1`;".to_string(),
            ),
            // Rule 13 — HTTP auth headers (each demonstrated by the Phase 13
            // audit as surviving rules 1-12 untouched).
            (
                "auth1",
                "Authorization: Basic YWRtaW46c3VwZXJzZWNyZXRwYXNzd29yZA==".to_string(),
            ),
            (
                "auth2",
                "Authorization: Bearer abcdef1234567890abcdef1234567890".to_string(),
            ),
            (
                "auth3",
                r#"headers = { authorization: "Bearer sV9pQ2xR7tL4zK8mN3bW" }"#.to_string(),
            ),
            // Rule 14 — hex-only blobs, which rule 12 structurally cannot reach
            // (two character classes, ~3.8 bits/char).
            (
                "hex1",
                r#"const s = "d41d8cd98f00b204e9800998ecf8427e5f2a3b4c";"#.to_string(),
            ),
            (
                "hex2",
                "webhookSignature = 5f2a3b4c5d6e7f809a0b1c2d3e4f5061".to_string(),
            ),
            // Rule 15 — a PEM body pasted without its BEGIN/END markers, which
            // rule 1 keys off and therefore never sees.
            (
                "pembody1",
                "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ".to_string(),
            ),
        ]
    }

    /// The full corpus: credential-shaped entries plus the rest.
    pub(super) fn planted_secrets_for_rule_check() -> Vec<(&'static str, String)> {
        planted_secrets()
    }

    fn planted_secrets() -> Vec<(&'static str, String)> {
        let mut all = planted_credential_secrets();
        all.extend(planted_credential_secrets_b());
        all.extend(planted_non_credential_secrets());
        all.extend(planted_heuristic_secrets());
        all
    }

    /// Five lines that must survive redaction byte-for-byte. None is
    /// credential-shaped, so none needs splitting.
    const NEGATIVE_CONTROLS: &[(&str, &str)] = &[
        ("neg1", "// this is just a comment explaining the code"),
        ("neg2", r#"const label = "hello world";"#),
        ("neg3", "PORT=3000"),
        ("neg4", "const url = \"https://example.com/api/v1\";"),
        ("neg5", r#"const filler = "aaaaaaaaaaaaaaaaaaaaaaaaaaaa";"#),
    ];

    #[test]
    fn redaction_corpus_has_at_least_thirty_planted_secrets_and_five_negatives() {
        assert!(
            planted_secrets().len() >= 30,
            "only {} planted secrets",
            planted_secrets().len()
        );
        assert_eq!(NEGATIVE_CONTROLS.len(), 5);
    }

    #[test]
    fn every_planted_secret_is_redacted() {
        for (name, line) in planted_secrets().iter() {
            let result = snippets_result(&[(*name, line.as_str())]);
            let redacted =
                redact(&result, &[]).unwrap_or_else(|e| panic!("{name}: redact() aborted: {e:?}"));
            let sent = redacted.to_request_snippets();
            assert_eq!(sent.len(), 1, "{name}: expected the file to survive R1");
            let content = &sent[0].content;
            assert!(
                content.contains("<redacted>"),
                "{name}: expected a <redacted> marker in {content:?}"
            );
        }
    }

    #[test]
    fn every_negative_control_survives_intact() {
        for (name, line) in NEGATIVE_CONTROLS {
            let result = snippets_result(&[(*name, *line)]);
            let redacted =
                redact(&result, &[]).unwrap_or_else(|e| panic!("{name}: redact() aborted: {e:?}"));
            let sent = redacted.to_request_snippets();
            assert_eq!(sent.len(), 1);
            assert_eq!(
                &sent[0].content, line,
                "{name}: negative control was altered"
            );
        }
    }

    #[test]
    fn line_counts_are_preserved_exactly_for_every_planted_secret() {
        for (name, line) in planted_secrets().iter() {
            let result = snippets_result(&[(*name, line.as_str())]);
            let redacted = redact(&result, &[]).unwrap();
            let sent = redacted.to_request_snippets();
            let original_lines = line.split('\n').count();
            let redacted_lines = sent[0].content.split('\n').count();
            assert_eq!(redacted_lines, original_lines, "{name}: line count changed");
        }
    }

    #[test]
    fn a_multiline_pem_private_key_is_fully_redacted_with_line_count_preserved() {
        let content = "before\n-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK...\n-----END RSA PRIVATE KEY-----\nafter";
        let result = snippets_result(&[("key.pem.txt", content)]);
        let redacted = redact(&result, &[]).unwrap();
        let sent = redacted.to_request_snippets();
        assert_eq!(
            sent[0].content.split('\n').count(),
            content.split('\n').count()
        );
        assert!(!sent[0].content.contains("MIIBOgIBAAJBAK"));
    }

    // -----------------------------------------------------------------
    // R1 — whole-file exclusion
    // -----------------------------------------------------------------

    #[test]
    fn r1_excludes_env_files_entirely() {
        let result = snippets_result(&[(".env", "SECRET=whatever-not-even-scanned")]);
        let redacted = redact(&result, &[]).unwrap();
        assert_eq!(redacted.sent_file_count(), 0);
    }

    #[test]
    fn r1_excludes_files_matching_a_user_exclude_glob() {
        let result = snippets_result(&[("fixtures/data.snap", "REDACTED-AWS-BY-HISTORY-REWRITE")]);
        let redacted = redact(&result, &["**/*.snap".to_string()]).unwrap();
        assert_eq!(redacted.sent_file_count(), 0);
    }

    // -----------------------------------------------------------------
    // R3 — idempotence aborts rather than sending a partial redaction
    // -----------------------------------------------------------------

    #[test]
    fn r3_ensure_idempotent_passes_when_the_two_passes_agree() {
        assert!(ensure_idempotent("same", "same").is_ok());
    }

    #[test]
    fn r3_ensure_idempotent_aborts_with_ai_payload_unsafe_when_they_differ() {
        // `redact()`'s two real passes are, by construction, equal for
        // every input in the corpus below (proven by
        // `full_corpus_round_trip_is_idempotent` and the property test in
        // `idempotence_property` — every rule's replacement is the fixed,
        // short, low-entropy `<redacted>` placeholder, which cannot itself
        // create a NEW match, so a genuinely non-idempotent real input is
        // vanishingly hard to construct on purpose). This test instead
        // proves the conditional itself is wired correctly: IF a future
        // rule (or an edge case neither the corpus nor 256 property-test
        // cases found) ever did produce two different passes, this is
        // the exact logic that catches it and the exact code it returns.
        let err = ensure_idempotent("pass-one-output", "pass-two-output-differs").unwrap_err();
        assert_eq!(err.code, "E_AI_PAYLOAD_UNSAFE");
    }

    #[test]
    fn full_corpus_round_trip_is_idempotent() {
        for (name, line) in planted_secrets()
            .iter()
            .map(|(n, l)| (*n, l.as_str()))
            .chain(NEGATIVE_CONTROLS.iter().copied())
        {
            let once = apply_r2_pipeline(line);
            let twice = apply_r2_pipeline(&once);
            assert_eq!(
                once, twice,
                "{name}: pipeline is not idempotent for {line:?}"
            );
        }
    }

    // -----------------------------------------------------------------
    // R4 — caps
    // -----------------------------------------------------------------

    #[test]
    fn r4_caps_a_400kb_snippet_set_to_the_aggregate_budget() {
        let big_content = "x".repeat(20_000); // one file, 20,000 bytes raw
        let entries: Vec<(String, String)> = (0..20)
            .map(|i| (format!("file-{i}.ts"), big_content.clone()))
            .collect();
        let entries_ref: Vec<(&str, &str)> = entries
            .iter()
            .map(|(p, c)| (p.as_str(), c.as_str()))
            .collect();
        let result = snippets_result(&entries_ref);

        let total_raw_bytes: usize = entries.iter().map(|(_, c)| c.len()).sum();
        assert!(total_raw_bytes > 400_000 / 2, "sanity: input is large");

        let redacted = redact(&result, &[]).unwrap();
        assert!(redacted.sent_file_count() <= AI_MAX_FILES);
        assert!(redacted.sent_byte_count() <= AI_MAX_TOTAL_BYTES);
    }

    #[test]
    fn r4_caps_per_file_line_and_byte_count() {
        let content = (0..500)
            .map(|i| format!("line {i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let result = snippets_result(&[("big.ts", &content)]);
        let redacted = redact(&result, &[]).unwrap();
        let sent = redacted.to_request_snippets();
        assert!(sent[0].content.split('\n').count() <= AI_MAX_LINES_PER_FILE);
        assert!(sent[0].content.len() <= AI_MAX_BYTES_PER_FILE);
    }

    // -----------------------------------------------------------------
    // Debug/Display must never print raw content
    // -----------------------------------------------------------------

    #[test]
    fn debug_and_display_never_print_the_secret_or_raw_content() {
        let result = snippets_result(&[("aws.ts", "REDACTED-AWS-BY-HISTORY-REWRITE")]);
        let redacted = redact(&result, &[]).unwrap();
        let debug_output = format!("{redacted:?}");
        let display_output = format!("{redacted}");
        assert!(!debug_output.contains("AKIA"));
        assert!(!display_output.contains("AKIA"));
        assert!(debug_output.contains("file_count"));
        assert!(display_output.contains("redacted payload"));
    }
}

/// Section 11's fast-check-equivalent property test: "redaction idempotence
/// over generated secret-like strings." `proptest` (not `quickcheck`): it is
/// the more actively maintained of the two, generates readable minimal
/// counterexamples (shrinking) out of the box, and this codebase's Rust
/// side has no existing property-test dependency to stay consistent with
/// either way. Bounded to printable ASCII + newlines: unbounded arbitrary
/// `String` generation spends most of its budget on exotic Unicode that
/// says nothing about THIS pipeline (which operates on lines of source
/// code/config, not arbitrary byte soup), and dilutes the search away from
/// the assignment-heuristic/high-entropy edge cases that actually matter.
#[cfg(test)]
mod idempotence_property {
    use super::apply_r2_pipeline;
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn redaction_pipeline_is_idempotent(input in "[ -~\n]{0,300}") {
            let once = apply_r2_pipeline(&input);
            let twice = apply_r2_pipeline(&once);
            prop_assert_eq!(once, twice);
        }

        #[test]
        fn redaction_pipeline_preserves_line_count(input in "[ -~\n]{0,300}") {
            let redacted = apply_r2_pipeline(&input);
            prop_assert_eq!(redacted.split('\n').count(), input.split('\n').count());
        }
    }
}

/// Per-family non-vacuity for the redaction corpus.
///
/// The corpus asserts that every planted secret is redacted. That is
/// necessary and not sufficient: an entry could be caught INCIDENTALLY by a
/// different rule than the one it was written for, leaving the corpus looking
/// complete while the rule it names is never exercised. The split of the
/// literals into `privacy::fake_secrets` made this urgent — a rewrite that
/// changed a string just enough to stop triggering its own rule would be
/// invisible to the corpus test.
///
/// So for each family: disable that ONE rule and assert the entry survives.
/// If it is still redacted with its rule off, something else is catching it
/// and the entry proves nothing about the rule it claims to cover.
#[cfg(test)]
mod per_rule_non_vacuity {
    use super::tests::planted_secrets_for_rule_check;
    use crate::privacy::patterns::{
        apply_single_line_rules, apply_single_line_rules_except, REDACTED_PLACEHOLDER,
    };

    /// Corpus entry -> the rule that must be the one catching it.
    const ENTRY_RULE: &[(&str, &str)] = &[
        ("aws1", "aws"),
        ("aws2", "aws"),
        ("aws3", "aws"),
        ("gh1", "github"),
        ("gh2", "github"),
        ("gh3", "github"),
        ("slack1", "slack"),
        ("slack2", "slack"),
        ("slack3", "slack"),
        ("stripe1", "stripe"),
        ("stripe2", "stripe"),
        ("stripe3", "stripe"),
        ("google1", "google"),
        ("google2", "google"),
        ("openai1", "openai"),
        ("openai2", "openai"),
        ("anthropic1", "anthropic"),
        ("anthropic2", "anthropic"),
        ("jwt1", "jwt"),
        ("jwt2", "jwt"),
    ];

    /// Per FAMILY, not per entry.
    ///
    /// Requiring EVERY entry to survive its rule being disabled is too
    /// strong, and the first run proved it: `aws1` is
    /// `aws_access_key_id = AKIA...`, which rule 11 (the assignment
    /// heuristic) also catches, so it stays redacted with the AWS rule off.
    /// That is a pre-existing property of the corpus, not a defect the
    /// literal split introduced — belt-and-braces coverage, not a hole.
    ///
    /// What DOES need to hold is that each family has at least one entry
    /// that genuinely depends on its own rule. Otherwise a family could be
    /// entirely covered by accident and its rule never exercised, which is
    /// exactly what the split could have caused by changing a string just
    /// enough to stop matching.
    #[test]
    fn every_split_family_has_at_least_one_entry_that_needs_its_own_rule() {
        let corpus = planted_secrets_for_rule_check();
        let mut families: Vec<&str> = ENTRY_RULE.iter().map(|(_, r)| *r).collect();
        families.sort_unstable();
        families.dedup();

        for rule_name in families {
            let entries: Vec<&(&str, String)> = corpus
                .iter()
                .filter(|(n, _)| {
                    ENTRY_RULE
                        .iter()
                        .any(|(en, er)| en == n && *er == rule_name)
                })
                .collect();
            assert!(
                !entries.is_empty(),
                "no corpus entries for rule {rule_name}"
            );

            // Every entry must be redacted with all rules on.
            for (name, line) in &entries {
                assert!(
                    apply_single_line_rules(line).contains(REDACTED_PLACEHOLDER),
                    "{name}: not redacted with all rules on"
                );
            }

            // At least one must SURVIVE with this rule alone disabled.
            let depends = entries.iter().any(|(_, line)| {
                !apply_single_line_rules_except(line, rule_name).contains(REDACTED_PLACEHOLDER)
            });
            assert!(
                depends,
                "rule {rule_name:?} is never exercised: every one of its corpus entries stays \n                 redacted with it disabled, so another rule is doing all the work"
            );
        }
    }

    /// Non-vacuity of THIS test: the mechanism must be able to fail. A rule
    /// name that does not exist must panic rather than silently skipping.
    #[test]
    #[should_panic(expected = "no rule named")]
    fn disabling_an_unknown_rule_is_a_hard_error() {
        let _ = apply_single_line_rules_except("anything", "not-a-real-rule");
    }
}

/// M4's measurement: how much of the corpus rests on R2.12 alone.
///
/// Section 8.9's rule 12 (high-entropy quoted literal) is the only catch-all
/// in the rule set — every other rule keys off a recognisable prefix or
/// structure. The Phase 13 audit's M4 finding accepted the corpus as proving
/// SHAPE coverage rather than completeness, and noted that R3 idempotence is
/// not coverage. This turns "how exposed are we if the catch-all misses" from
/// a judgement into a number.
#[cfg(test)]
mod r2_12_reliance {
    use super::tests::planted_secrets_for_rule_check;
    use crate::privacy::patterns::{
        apply_single_line_rules, apply_single_line_rules_except, REDACTED_PLACEHOLDER,
    };

    const ENTROPY_RULE: &str = "entropy";

    #[test]
    fn measure_entries_caught_only_by_the_high_entropy_catch_all() {
        let corpus = planted_secrets_for_rule_check();
        let mut only_entropy: Vec<&str> = Vec::new();

        for (name, line) in &corpus {
            let with_all = apply_single_line_rules(line).contains(REDACTED_PLACEHOLDER);
            let without_entropy =
                apply_single_line_rules_except(line, ENTROPY_RULE).contains(REDACTED_PLACEHOLDER);
            if with_all && !without_entropy {
                only_entropy.push(name);
            }
        }

        println!(
            "  R2.12 reliance: {} of {} corpus entries are caught ONLY by the high-entropy rule: {:?}",
            only_entropy.len(),
            corpus.len(),
            only_entropy
        );

        // Pinned so the measurement is a regression check, not just a print.
        // If a future rule change moves an entry onto or off the catch-all,
        // this fails and the SECURITY_AUDIT.md figure gets revisited rather
        // than silently going stale.
        assert_eq!(
            only_entropy.len(),
            2,
            "R2.12 reliance changed: {only_entropy:?}. Update docs/SECURITY_AUDIT.md's \
             criterion-16 evidence before changing this number."
        );
    }
}
