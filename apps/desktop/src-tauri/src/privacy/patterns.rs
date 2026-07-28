//! Section 8.9's R1 (file exclusion) and R2 (the line rules) patterns,
//! compiled once via `once_cell::Lazy`. Pure functions only — nothing here
//! touches the filesystem or the network. `redact.rs` is the only caller.
//!
//! ## Rules 13-15 (Phase 13 finding M4)
//!
//! 8.9's rule list is an ORDERED, NUMBERED list, so it is extended by
//! APPENDING — rules 1-12 keep their numbers, their regexes and their
//! relative order exactly, and the new rules run after them. That matters
//! for more than tidiness: several of the new shapes overlap older rules
//! (`Authorization: Bearer eyJ…` is a JWT first, rule 9's business), and
//! appending is what keeps the older, more specific rule the one that fires
//! — so no existing corpus expectation changes.
//!
//! The three shapes the audit demonstrated surviving rules 1-12, and why
//! each survived:
//!
//! 13. **HTTP auth headers.** Rule 11's value group starts IMMEDIATELY
//!     after the `:`/`=`, so in `Authorization: Basic <b64>` the value it
//!     sees is `Basic` — five characters, under its 8-character minimum —
//!     and the whole rule fails. Rule 13 allows the scheme token between
//!     the operator and the credential.
//! 14. **Hex-only blobs.** A 40-character hex string has two character
//!     classes (below rule 12's minimum of three) and about 3.8 bits/char
//!     (below its 4.0), so it fails rule 12 twice over. Digests and
//!     hex-encoded API keys are exactly the shape rule 12's
//!     character-class requirement structurally cannot reach.
//! 15. **Base64 blobs.** A PEM body pasted WITHOUT its `BEGIN`/`END`
//!     markers is invisible to rule 1 (which keys off the markers) and, as
//!     unquoted bare text, to rule 12 as well.
//!
//! Rule 12 itself is not renumbered or reordered; its literal detection
//! simply also recognises JS backtick template literals, which are quoted
//! strings in every sense 8.9's "quoted string, length >= 24, ..." means —
//! the original implementation just did not spell the third delimiter.
//!
//! Every new rule replaces its match with the same fixed
//! [`REDACTED_PLACEHOLDER`], which contains no hex-only run of 32, no
//! base64 run of 40, and no credential after an auth scheme — so none of
//! them can re-match its own output and R3's idempotence check keeps
//! holding (property-tested in `redact.rs`).

use once_cell::sync::Lazy;
use regex::Regex;

use crate::constants::{
    ASSIGNMENT_HEURISTIC_MIN_VALUE_LEN, AUTH_SCHEME_MIN_VALUE_LEN, BASE64_BLOB_MIN_LEN,
    HEX_BLOB_MIN_LEN, HIGH_ENTROPY_MIN_BITS_PER_CHAR, HIGH_ENTROPY_MIN_CHAR_CLASSES,
    HIGH_ENTROPY_MIN_LEN,
};

// ---------------------------------------------------------------------------
// R1 — whole-file exclusion
// ---------------------------------------------------------------------------

const EXCLUDED_EXTENSIONS: &[&str] = &[
    "pem", "key", "p12", "pfx", "jks", "keystore", "ppk", "asc", "gpg",
];

static ID_RSA_STYLE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^id_(rsa|dsa|ecdsa|ed25519)").expect("valid regex"));

static SECRETS_CREDENTIALS_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^(secrets?|credentials?)\.").expect("valid regex"));

fn basename(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn extension(name: &str) -> Option<&str> {
    let dot_index = name.rfind('.')?;
    if dot_index == 0 {
        return None; // a leading dot (".env") is not an "extension" here
    }
    Some(&name[dot_index + 1..])
}

/// A tiny, intentionally minimal glob matcher for user `excludeGlobs`
/// (`*`, `**`, `?` only) — not full gitignore semantics (that is the
/// engine's `ignore` crate, for its own walk, a much larger surface this
/// module has no reason to duplicate).
pub fn matches_glob(path: &str, pattern: &str) -> bool {
    let path_bytes: Vec<char> = path.chars().collect();
    let pattern_bytes: Vec<char> = pattern.chars().collect();
    glob_match(&path_bytes, &pattern_bytes)
}

fn glob_match(path: &[char], pattern: &[char]) -> bool {
    match pattern.first() {
        None => path.is_empty(),
        Some('*') => {
            if pattern.get(1) == Some(&'*') {
                let rest = &pattern[2..];
                let rest = if rest.first() == Some(&'/') {
                    &rest[1..]
                } else {
                    rest
                };
                (0..=path.len()).any(|i| glob_match(&path[i..], rest))
            } else {
                let rest = &pattern[1..];
                (0..=path.len()).any(|i| glob_match(&path[i..], rest))
            }
        }
        Some('?') => !path.is_empty() && glob_match(&path[1..], &pattern[1..]),
        Some(literal) => path.first() == Some(literal) && glob_match(&path[1..], &pattern[1..]),
    }
}

pub fn is_excluded_file(path: &str, user_exclude_globs: &[String]) -> bool {
    let name = basename(path);
    let lower_name = name.to_ascii_lowercase();

    if lower_name == ".env" || lower_name.starts_with(".env.") {
        return true;
    }
    if let Some(ext) = extension(&lower_name) {
        if EXCLUDED_EXTENSIONS.contains(&ext) {
            return true;
        }
    }
    if ID_RSA_STYLE_RE.is_match(name) {
        return true;
    }
    if SECRETS_CREDENTIALS_RE.is_match(name) {
        return true;
    }
    user_exclude_globs
        .iter()
        .any(|glob| matches_glob(path, glob))
}

// ---------------------------------------------------------------------------
// R2 — line rules 2-9 (whole-match secrets) and rule 10 (connection string)
// ---------------------------------------------------------------------------

static PEM_BEGIN_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"BEGIN.*PRIVATE KEY").expect("valid regex"));
static PEM_END_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"END.*PRIVATE KEY").expect("valid regex"));

static AWS_KEY_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"AKIA[0-9A-Z]{16}").expect("valid regex"));
static GITHUB_TOKEN_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"gh[pousr]_[A-Za-z0-9]{36,}").expect("valid regex"));
static SLACK_TOKEN_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"xox[abpsr]-[A-Za-z0-9-]{10,}").expect("valid regex"));
static STRIPE_KEY_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(sk|rk|pk)_live_[A-Za-z0-9]{16,}").expect("valid regex"));
static GOOGLE_KEY_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"AIza[0-9A-Za-z_-]{35}").expect("valid regex"));
static OPENAI_KEY_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"sk-[A-Za-z0-9]{20,}").expect("valid regex"));
static ANTHROPIC_KEY_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"sk-ant-[A-Za-z0-9_-]{20,}").expect("valid regex"));
static JWT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")
        .expect("valid regex")
});
static CONNECTION_STRING_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"([a-z][a-z0-9+.-]*://)([^\s:@/]+:[^\s@/]+)@").expect("valid regex"));
static ASSIGNMENT_HEURISTIC_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r#"(?i)(\b\w*(?:KEY|TOKEN|SECRET|PASSWORD|PASSPHRASE|CREDENTIAL|PRIVATE|AUTH)\w*\s*[:=]\s*)(["']?)([^\s"',;]{{{ASSIGNMENT_HEURISTIC_MIN_VALUE_LEN},}})(["']?)"#
    ))
    .expect("valid regex")
});
static HIGH_ENTROPY_DOUBLE_QUOTED_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#""([^"\\]{24,})""#).expect("valid regex"));
static HIGH_ENTROPY_SINGLE_QUOTED_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"'([^'\\]{24,})'").expect("valid regex"));
/// Rule 12's third delimiter: a JS template literal. Same shape as the
/// other two, and deliberately the same threshold — a secret does not stop
/// being a secret because it was interpolated into a backticked string.
static HIGH_ENTROPY_BACKTICK_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"`([^`\\]{24,})`").expect("valid regex"));

/// Rule 13. Case-insensitive, allows the header to be written as a real
/// header (`Authorization: …`), as an assignment (`authorization = …`) and
/// with or without a surrounding quote, because all three appear in source.
/// The credential class is RFC 7235's `token68` (`A-Za-z0-9-._~+/=`), which
/// covers Basic's base64, Bearer's opaque tokens and API-gateway keys — and
/// notably excludes `<`, so the rule cannot re-match `<redacted>`.
static AUTH_HEADER_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r#"(?i)(\bauthorization\s*[:=]\s*["']?(?:basic|bearer|token|digest|apikey)\s+)([A-Za-z0-9\-._~+/=]{{{AUTH_SCHEME_MIN_VALUE_LEN},}})"#
    ))
    .expect("valid regex")
});

/// Rule 14. Anchored on `\b` at both ends so it redacts a whole hex token
/// and never a fragment of a longer identifier.
static HEX_BLOB_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(r"\b[0-9a-fA-F]{{{HEX_BLOB_MIN_LEN},}}\b")).expect("valid regex")
});

/// Rule 15's candidate runs. The run alone is not enough to redact — see
/// [`is_base64_blob`] for the mixed-case-plus-digit requirement that keeps
/// a long lowercase word or an ALL-CAPS constant out of scope.
static BASE64_BLOB_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(r"[A-Za-z0-9+/]{{{BASE64_BLOB_MIN_LEN},}}={{0,2}}")).expect("valid regex")
});

/// The literal placeholder every rule replaces a secret with. Section 8.9
/// R3 requires the redacted OUTPUT to survive a second R2 pass unchanged;
/// without this guard rule 11 (a generic "dense token after a KEY/TOKEN/...
/// name" heuristic) would re-match its own eleven-character placeholder
/// forever, since `<redacted>` itself satisfies `[^\s"',;]{8,}` — see
/// `docs/DECISIONS.md`.
pub const REDACTED_PLACEHOLDER: &str = "<redacted>";

/// True when every line between a `BEGIN ... PRIVATE KEY` and the matching
/// `END ... PRIVATE KEY` (inclusive) has been replaced by `redact_pem_blocks`.
pub fn redact_pem_blocks(lines: &[&str]) -> Vec<String> {
    let mut inside_block = false;
    lines
        .iter()
        .map(|line| {
            if inside_block {
                if PEM_END_RE.is_match(line) {
                    inside_block = false;
                }
                REDACTED_PLACEHOLDER.to_string()
            } else if PEM_BEGIN_RE.is_match(line) {
                if !PEM_END_RE.is_match(line) {
                    inside_block = true;
                }
                REDACTED_PLACEHOLDER.to_string()
            } else {
                (*line).to_string()
            }
        })
        .collect()
}

fn redact_whole_match(line: &str, pattern: &Lazy<Regex>) -> String {
    pattern.replace_all(line, REDACTED_PLACEHOLDER).into_owned()
}

fn redact_connection_string(line: &str) -> String {
    CONNECTION_STRING_RE
        .replace_all(line, |caps: &regex::Captures<'_>| {
            format!("{}{REDACTED_PLACEHOLDER}@", &caps[1])
        })
        .into_owned()
}

fn redact_assignment_heuristic(line: &str) -> String {
    ASSIGNMENT_HEURISTIC_RE
        .replace_all(line, |caps: &regex::Captures<'_>| {
            let value = &caps[3];
            if value == REDACTED_PLACEHOLDER {
                // Already our own placeholder (R3's re-scan, or genuinely
                // adjacent redactions) — leave it alone rather than
                // "re-redacting" text that was never a real secret.
                return caps[0].to_string();
            }
            format!("{}{}{REDACTED_PLACEHOLDER}{}", &caps[1], &caps[2], &caps[4])
        })
        .into_owned()
}

/// Shannon entropy in bits per character (base-2), over the string's `char`s.
fn shannon_entropy_bits_per_char(value: &str) -> f64 {
    let len = value.chars().count();
    if len == 0 {
        return 0.0;
    }
    let mut counts: std::collections::HashMap<char, u32> = std::collections::HashMap::new();
    for c in value.chars() {
        *counts.entry(c).or_insert(0) += 1;
    }
    let len_f = len as f64;
    // Deterministic regardless of hash-map iteration order: entropy is a
    // sum, and floating-point addition here is over character COUNTS
    // (integers, exact), only the final division/log2 is inexact — order
    // of summation of these particular terms does not change the result
    // at any representable precision for this input size.
    -counts
        .values()
        .map(|&count| {
            let p = f64::from(count) / len_f;
            p * p.log2()
        })
        .sum::<f64>()
}

fn char_class_count(value: &str) -> u32 {
    let mut classes = 0u32;
    if value.chars().any(|c| c.is_ascii_lowercase()) {
        classes += 1;
    }
    if value.chars().any(|c| c.is_ascii_uppercase()) {
        classes += 1;
    }
    if value.chars().any(|c| c.is_ascii_digit()) {
        classes += 1;
    }
    if value.chars().any(|c| !c.is_ascii_alphanumeric()) {
        classes += 1;
    }
    classes
}

fn is_high_entropy_secret(value: &str) -> bool {
    value.chars().count() >= HIGH_ENTROPY_MIN_LEN
        && char_class_count(value) >= HIGH_ENTROPY_MIN_CHAR_CLASSES
        && shannon_entropy_bits_per_char(value) >= HIGH_ENTROPY_MIN_BITS_PER_CHAR
}

/// One delimiter's worth of rule 12. The delimiter is re-emitted verbatim
/// so the line's shape (and length in lines) is untouched.
fn redact_high_entropy_delimited(line: &str, pattern: &Lazy<Regex>, delimiter: char) -> String {
    pattern
        .replace_all(line, |caps: &regex::Captures<'_>| {
            if is_high_entropy_secret(&caps[1]) {
                format!("{delimiter}{REDACTED_PLACEHOLDER}{delimiter}")
            } else {
                caps[0].to_string()
            }
        })
        .into_owned()
}

fn redact_high_entropy_literal(line: &str) -> String {
    let current = redact_high_entropy_delimited(line, &HIGH_ENTROPY_DOUBLE_QUOTED_RE, '"');
    let current = redact_high_entropy_delimited(&current, &HIGH_ENTROPY_SINGLE_QUOTED_RE, '\'');
    redact_high_entropy_delimited(&current, &HIGH_ENTROPY_BACKTICK_RE, '`')
}

/// Rule 13: keep the header name and the auth scheme, redact the
/// credential — the same "preserve the line's prefix" shape rules 10 and 11
/// use, so a reader still sees WHICH scheme was in play.
fn redact_auth_header(line: &str) -> String {
    AUTH_HEADER_RE
        .replace_all(line, |caps: &regex::Captures<'_>| {
            format!("{}{REDACTED_PLACEHOLDER}", &caps[1])
        })
        .into_owned()
}

/// Rule 15's discriminator. A base64 body of real key material mixes cases
/// and digits; a 40-character run that is all one case, or has no digit, is
/// far more likely to be an identifier or a word than a secret.
fn is_base64_blob(value: &str) -> bool {
    value.chars().any(|c| c.is_ascii_lowercase())
        && value.chars().any(|c| c.is_ascii_uppercase())
        && value.chars().any(|c| c.is_ascii_digit())
}

fn redact_base64_blob(line: &str) -> String {
    BASE64_BLOB_RE
        .replace_all(line, |caps: &regex::Captures<'_>| {
            if is_base64_blob(&caps[0]) {
                REDACTED_PLACEHOLDER.to_string()
            } else {
                caps[0].to_string()
            }
        })
        .into_owned()
}

/// Rules 2 through 15, applied in Section 8.9's fixed order, to one line.
/// Rule 1 (PEM blocks) is multi-line and handled separately by
/// `redact_pem_blocks` before this ever runs. Rules 13-15 are Phase 13's
/// additive extension and run last, so no rule 2-12 match changes — see
/// this module's doc comment.
pub fn apply_single_line_rules(line: &str) -> String {
    let mut current = line.to_string();
    current = redact_whole_match(&current, &AWS_KEY_RE);
    current = redact_whole_match(&current, &GITHUB_TOKEN_RE);
    current = redact_whole_match(&current, &SLACK_TOKEN_RE);
    current = redact_whole_match(&current, &STRIPE_KEY_RE);
    current = redact_whole_match(&current, &GOOGLE_KEY_RE);
    current = redact_whole_match(&current, &OPENAI_KEY_RE);
    current = redact_whole_match(&current, &ANTHROPIC_KEY_RE);
    current = redact_whole_match(&current, &JWT_RE);
    current = redact_connection_string(&current);
    current = redact_assignment_heuristic(&current);
    current = redact_high_entropy_literal(&current);
    current = redact_auth_header(&current);
    current = redact_whole_match(&current, &HEX_BLOB_RE);
    current = redact_base64_blob(&current);
    current
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn excludes_dotenv_files_by_basename() {
        assert!(is_excluded_file(".env", &[]));
        assert!(is_excluded_file(".env.production", &[]));
        assert!(is_excluded_file("config/.env", &[]));
        assert!(!is_excluded_file("environment.ts", &[]));
    }

    #[test]
    fn excludes_key_material_extensions() {
        for ext in [
            "pem", "key", "p12", "pfx", "jks", "keystore", "ppk", "asc", "gpg",
        ] {
            assert!(
                is_excluded_file(&format!("certs/server.{ext}"), &[]),
                "ext {ext}"
            );
        }
    }

    #[test]
    fn excludes_id_rsa_style_basenames() {
        assert!(is_excluded_file("id_rsa", &[]));
        assert!(is_excluded_file(".ssh/id_ed25519", &[]));
        assert!(!is_excluded_file("identity.ts", &[]));
    }

    #[test]
    fn excludes_secrets_and_credentials_basenames() {
        assert!(is_excluded_file("secrets.yaml", &[]));
        assert!(is_excluded_file("credentials.json", &[]));
        assert!(is_excluded_file("secret.json", &[]));
        assert!(!is_excluded_file("secretary.ts", &[]));
    }

    #[test]
    fn excludes_files_matching_a_user_glob() {
        let globs = vec!["**/*.snap".to_string()];
        assert!(is_excluded_file("src/__snapshots__/a.snap", &globs));
        assert!(!is_excluded_file("src/a.ts", &globs));
    }

    #[test]
    fn redacts_aws_key() {
        let out = apply_single_line_rules("key = REDACTED-AWS-BY-HISTORY-REWRITE");
        assert_eq!(out, "key = <redacted>");
    }

    #[test]
    fn redacts_pem_blocks_across_multiple_lines_preserving_line_count() {
        let lines = vec![
            "before",
            "-----BEGIN RSA PRIVATE KEY-----",
            "MIIBOgIBAAJBAK...",
            "-----END RSA PRIVATE KEY-----",
            "after",
        ];
        let out = redact_pem_blocks(&lines);
        assert_eq!(out.len(), lines.len());
        assert_eq!(out[0], "before");
        assert_eq!(out[1], "<redacted>");
        assert_eq!(out[2], "<redacted>");
        assert_eq!(out[3], "<redacted>");
        assert_eq!(out[4], "after");
    }

    #[test]
    fn redacts_connection_string_userinfo_only() {
        let out =
            apply_single_line_rules("DATABASE_URL=postgres://admin:hunter2@db.internal:5432/app");
        assert_eq!(
            out,
            "DATABASE_URL=postgres://<redacted>@db.internal:5432/app"
        );
    }

    #[test]
    fn redacts_assignment_heuristic_value_only() {
        let out = apply_single_line_rules(r#"API_KEY="abcdefgh12345678""#);
        assert_eq!(out, r#"API_KEY="<redacted>""#);
    }

    #[test]
    fn assignment_heuristic_does_not_re_redact_its_own_placeholder() {
        let out = apply_single_line_rules(r#"API_KEY="<redacted>""#);
        assert_eq!(out, r#"API_KEY="<redacted>""#);
    }

    #[test]
    fn redacts_high_entropy_quoted_literal() {
        let out = apply_single_line_rules(r#"const token = "aB3$kL9!pQ2&mZ7@wR4^tY1*";"#);
        assert_eq!(out, r#"const token = "<redacted>";"#);
    }

    #[test]
    fn leaves_a_short_low_entropy_quoted_string_untouched() {
        let out = apply_single_line_rules(r#"const label = "hello world";"#);
        assert_eq!(out, r#"const label = "hello world";"#);
    }

    // -----------------------------------------------------------------
    // Rules 13-15 and rule 12's third delimiter (Phase 13 finding M4).
    // Every case here is one the audit demonstrated surviving rules 1-12.
    // -----------------------------------------------------------------

    #[test]
    fn rule_13_redacts_a_basic_auth_header_keeping_the_scheme() {
        let out =
            apply_single_line_rules("Authorization: Basic YWRtaW46c3VwZXJzZWNyZXRwYXNzd29yZA==");
        assert_eq!(out, "Authorization: Basic <redacted>");
    }

    #[test]
    fn rule_13_redacts_an_opaque_bearer_token() {
        let out = apply_single_line_rules("Authorization: Bearer abcdef1234567890abcdef1234567890");
        assert_eq!(out, "Authorization: Bearer <redacted>");
    }

    #[test]
    fn rule_13_handles_the_quoted_assignment_spelling_too() {
        let out = apply_single_line_rules(
            r#"headers = { authorization: "Bearer sV9pQ2xR7tL4zK8mN3bW" }"#,
        );
        assert!(out.contains("<redacted>"), "{out}");
        assert!(!out.contains("sV9pQ2xR7tL4zK8mN3bW"), "{out}");
    }

    #[test]
    fn rule_14_redacts_a_hex_only_secret_in_a_quoted_literal() {
        let out =
            apply_single_line_rules(r#"const s = "d41d8cd98f00b204e9800998ecf8427e5f2a3b4c";"#);
        assert_eq!(out, r#"const s = "<redacted>";"#);
    }

    /// The threshold is a real boundary, and it sits above the longest
    /// single-class run the corpus's negative controls contain (28), so
    /// `every_negative_control_survives_intact` cannot start failing by
    /// accident.
    #[test]
    fn a_hex_run_shorter_than_the_threshold_survives() {
        let short = "a".repeat(HEX_BLOB_MIN_LEN - 1);
        assert_eq!(
            apply_single_line_rules(&format!("const filler = \"{short}\";")),
            format!("const filler = \"{short}\";")
        );
        let exact = "a".repeat(HEX_BLOB_MIN_LEN);
        assert_eq!(
            apply_single_line_rules(&format!("const filler = \"{exact}\";")),
            "const filler = \"<redacted>\";"
        );
    }

    #[test]
    fn rule_15_redacts_a_pem_body_line_with_no_begin_or_end_marker() {
        let out = apply_single_line_rules("MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ");
        assert_eq!(out, "<redacted>");
    }

    /// A long slash-separated path is a base64 CHARACTER run but is not
    /// key material; the mixed-case-plus-digit requirement is what tells
    /// them apart, so this is the negative control for rule 15.
    #[test]
    fn a_long_slash_separated_import_path_is_not_a_base64_blob() {
        let line = "import x from 'src/components/answer/panel/section/inline/renderer'";
        assert_eq!(apply_single_line_rules(line), line);
    }

    /// Deliberately bound to `blob`, not `token`: a KEY/TOKEN/SECRET-ish
    /// name would be caught by rule 11 first and the test would pass with
    /// the backtick delimiter still missing.
    #[test]
    fn rule_12_redacts_a_high_entropy_backtick_template_literal() {
        let out = apply_single_line_rules("const blob = `Xk2$Qw9!Zp4&Rt7@Lm3^Vn8*Bh1`;");
        assert_eq!(out, "const blob = `<redacted>`;");
    }

    #[test]
    fn an_ordinary_backtick_template_literal_survives() {
        let line = "const greeting = `hello there, friend`;";
        assert_eq!(apply_single_line_rules(line), line);
    }

    /// R3 is a whole-payload property proved in `redact.rs`, but the new
    /// rules are exactly where a second pass could differ, so each is
    /// pinned here at the rule level as well.
    #[test]
    fn the_new_rules_are_individually_idempotent() {
        for line in [
            "Authorization: Basic YWRtaW46c3VwZXJzZWNyZXRwYXNzd29yZA==",
            "Authorization: Bearer abcdef1234567890abcdef1234567890",
            r#"const s = "d41d8cd98f00b204e9800998ecf8427e5f2a3b4c";"#,
            "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ",
            "const blob = `Xk2$Qw9!Zp4&Rt7@Lm3^Vn8*Bh1`;",
        ] {
            let once = apply_single_line_rules(line);
            assert_eq!(
                apply_single_line_rules(&once),
                once,
                "not idempotent: {line}"
            );
        }
    }

    /// Appending rather than renumbering is load-bearing: `Authorization:
    /// Bearer eyJ…` is a JWT, and rule 9 must still be the rule that fires
    /// so the older corpus expectation is untouched.
    #[test]
    fn an_earlier_rule_still_wins_over_the_appended_ones() {
        let out = apply_single_line_rules(
            "Authorization: Bearer REDACTED-JWT-BY-HISTORY-REWRITE.abcdefghij1234567890",
        );
        assert_eq!(out, "Authorization: Bearer <redacted>");
    }

    #[test]
    fn glob_matches_double_star_prefix() {
        assert!(matches_glob("a/b/c.snap", "**/*.snap"));
        assert!(matches_glob("c.snap", "**/*.snap"));
        assert!(!matches_glob("c.ts", "**/*.snap"));
    }
}
