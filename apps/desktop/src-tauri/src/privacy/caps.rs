//! Section 8.9 R4 — caps enforced after redaction, before anything is sent.
//! Pure functions over plain strings/sizes only: nothing here knows about
//! `Snippet` or `RedactedPayload` (`redact.rs` owns those types and calls
//! into this module, not the other way around), so there is no way for a
//! cap-bypass here to also become a construction path for either.

/// Truncates `content` to at most `max_lines` lines and at most `max_bytes`
/// bytes (whichever is stricter), never splitting a UTF-8 character.
/// Section 8.9 R4's per-file cap: Section 8.9 describes the "keep
/// highest-ranked files first, drop the tail" overflow behavior only for
/// the aggregate file-count/total-byte cap, not this per-file one —
/// truncating (rather than dropping the whole file) is the more useful
/// reading, since it preserves partial context instead of silently losing
/// an otherwise-relevant file (see `docs/DECISIONS.md`).
pub fn truncate_content(content: &str, max_lines: usize, max_bytes: usize) -> String {
    let line_limited: String = content
        .split('\n')
        .take(max_lines)
        .collect::<Vec<_>>()
        .join("\n");

    if line_limited.len() <= max_bytes {
        return line_limited;
    }
    let mut end = max_bytes;
    while end > 0 && !line_limited.is_char_boundary(end) {
        end -= 1;
    }
    line_limited[..end].to_string()
}

/// Given the byte length of each already-ranked (highest relevance first)
/// snippet, returns how many to keep so the result respects both
/// `max_files` and `max_total_bytes` — Section 8.9 R4: "keep highest-ranked
/// files first ..., drop the tail". Callers are responsible for the
/// ranking itself (search score desc, then path asc); `EngineSnippet`
/// carries no score field, so this module cannot re-rank on its own.
pub fn select_count_within_budget(
    byte_lens: &[usize],
    max_files: usize,
    max_total_bytes: usize,
) -> usize {
    let mut total = 0usize;
    let mut count = 0usize;
    for &len in byte_lens.iter().take(max_files) {
        if total.saturating_add(len) > max_total_bytes {
            break;
        }
        total += len;
        count += 1;
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_content_caps_line_count() {
        let content = (0..300)
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join("\n");
        let truncated = truncate_content(&content, 200, 1_000_000);
        assert_eq!(truncated.split('\n').count(), 200);
    }

    #[test]
    fn truncate_content_caps_byte_count_on_a_char_boundary() {
        let content = "é".repeat(100); // 2 bytes per char in UTF-8
        let truncated = truncate_content(&content, 1000, 9);
        assert!(truncated.len() <= 9);
        assert!(truncated.is_char_boundary(truncated.len()));
        assert!(std::str::from_utf8(truncated.as_bytes()).is_ok());
    }

    #[test]
    fn truncate_content_leaves_small_content_untouched() {
        let content = "line one\nline two";
        assert_eq!(truncate_content(content, 200, 8192), content);
    }

    #[test]
    fn select_count_within_budget_stops_at_max_files() {
        let lens = vec![10; 30];
        assert_eq!(select_count_within_budget(&lens, 24, 1_000_000), 24);
    }

    #[test]
    fn select_count_within_budget_stops_at_total_byte_cap() {
        let lens = vec![50_000, 50_000, 50_000];
        assert_eq!(select_count_within_budget(&lens, 24, 98_304), 1);
    }

    #[test]
    fn select_count_within_budget_keeps_everything_when_under_both_caps() {
        let lens = vec![100, 200, 300];
        assert_eq!(select_count_within_budget(&lens, 24, 98_304), 3);
    }
}
