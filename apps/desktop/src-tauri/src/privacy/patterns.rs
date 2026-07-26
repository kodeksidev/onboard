//! Section 8.9's R1 (file exclusion) and R2 (the twelve line rules)
//! patterns, compiled once via `once_cell::Lazy`. Pure functions only —
//! nothing here touches the filesystem or the network. `redact.rs` is the
//! only caller.

use once_cell::sync::Lazy;
use regex::Regex;

use crate::constants::{
    ASSIGNMENT_HEURISTIC_MIN_VALUE_LEN, HIGH_ENTROPY_MIN_BITS_PER_CHAR,
    HIGH_ENTROPY_MIN_CHAR_CLASSES, HIGH_ENTROPY_MIN_LEN,
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

fn redact_high_entropy_literal(line: &str) -> String {
    let after_double =
        HIGH_ENTROPY_DOUBLE_QUOTED_RE.replace_all(line, |caps: &regex::Captures<'_>| {
            if is_high_entropy_secret(&caps[1]) {
                format!("\"{REDACTED_PLACEHOLDER}\"")
            } else {
                caps[0].to_string()
            }
        });
    HIGH_ENTROPY_SINGLE_QUOTED_RE
        .replace_all(&after_double, |caps: &regex::Captures<'_>| {
            if is_high_entropy_secret(&caps[1]) {
                format!("'{REDACTED_PLACEHOLDER}'")
            } else {
                caps[0].to_string()
            }
        })
        .into_owned()
}

/// Rules 2 through 12, applied in Section 8.9's fixed order, to one line.
/// Rule 1 (PEM blocks) is multi-line and handled separately by
/// `redact_pem_blocks` before this ever runs.
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

    #[test]
    fn glob_matches_double_star_prefix() {
        assert!(matches_glob("a/b/c.snap", "**/*.snap"));
        assert!(matches_glob("c.snap", "**/*.snap"));
        assert!(!matches_glob("c.ts", "**/*.snap"));
    }
}
