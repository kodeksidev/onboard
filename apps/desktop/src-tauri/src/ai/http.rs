//! `ai/http.rs` — Section 5: "THE ONLY `reqwest` CLIENT IN THE REPOSITORY."
//!
//! [`send`] is the single function in this entire crate allowed to reach
//! the network. Its structural guarantees (the WHAT/WHETHER/WHERE triad —
//! see `ai/endpoint.rs`'s doc comment for the full picture):
//!
//! 1. **Cannot be called without proof AI is on.** The first parameter is
//!    `&EgressPermit` ([`crate::ai::permit`]), which has no public
//!    constructor — see that module's doc comment. `tests/ai_permit_compile_fail.rs`
//!    proves a caller without one cannot call this function at all.
//! 2. **Cannot be called with unredacted content.** The `payload` parameter
//!    is [`crate::privacy::redact::RedactedPayload`], not `&str`/`String`/
//!    `impl Into<String>` — see `redact.rs`'s doc comment for what that
//!    does and does not guarantee.
//! 3. **Cannot be pointed at an arbitrary host.** The `endpoint` parameter
//!    is [`crate::ai::endpoint::ResolvedEndpoint`], not `&str`/`String` —
//!    see that module's doc comment.
//!
//! ## No free-form body — the owner's Phase 12 step 3A ruling
//!
//! An earlier version of this module took a caller-built `body:
//! &serde_json::Value`, with a runtime check that the payload's content
//! appeared *somewhere* inside it. The owner ruled that incoherent: a
//! free-form JSON channel is the same defect pattern as the three legs
//! above — a caller-controlled path that can carry anything, including a
//! second, unredacted copy of repo content that happens to also satisfy a
//! substring check. There is no `body` parameter anymore, and nothing
//! resembling one — `send` builds the request body itself, from
//! [`ProviderShape`] (which shape of request — never adapter- or
//! caller-supplied content) plus `model` (a plain string, from stored
//! settings by the time an adapter calls this) plus `payload` (the only
//! source of snippet content, always). An adapter cannot put anything into
//! the outbound body beyond what [`build_body`] puts there, because no
//! parameter exists through which it could — see
//! `tests/ai_provider_body_compile_fail.rs`. §3 non-goal 2 caps v1 at
//! exactly the three shapes in [`ProviderShape`], so this module knowing
//! all three costs little and buys back the closed channel.
//!
//! Phase 12 step 6 replaced the old `TASK_INSTRUCTIONS_PLACEHOLDER`
//! constant with real per-feature prompts — WITHOUT re-opening the channel
//! this section exists to keep shut. The `payload: &RedactedPayload`
//! parameter became `prompt: &`[`crate::ai::prompt::PromptSpec`], a type
//! that (a) can only be constructed from a `RedactedPayload`, so the WHAT
//! leg is inherited rather than replaced, and (b) has private fields and no
//! public constructor of any kind, so a caller still cannot author the task
//! text. `send`'s arity is unchanged at six, there is still no `body`
//! parameter, and [`build_body`] still assembles the JSON itself — from
//! [`ProviderShape`] + `model` + the `PromptSpec`'s own fixed `task`,
//! validated `subject`, and redacted snippets. See `ai/prompt.rs`'s doc
//! comment for the full writeup.
//!
//! Section 12 error hygiene: a response body, a provider error string, or
//! an OS/transport error string is NEVER placed in `AppError.message` —
//! only in `.detail` (same convention Phase 11 fixed `error.rs` to follow
//! everywhere else). The mapping functions below take already-extracted
//! plain data (status code, body text, a boolean) rather than the HTTP
//! client's own error type itself specifically so they are unit-testable
//! without a live network call.
//!
//! ## `RequestHeaders`, and why adapters never see `reqwest::header::HeaderMap`
//!
//! An early version of `send` took `reqwest::header::HeaderMap` directly
//! from its caller — which meant every adapter module (`ai/anthropic.rs`,
//! `ai/ollama.rs`) had to `use reqwest::header`
//! itself just to build an auth header, making `reqwest` a *second*
//! consumer of the crate even though those adapters never touch the client
//! or send anything themselves. [`RequestHeaders`] is plain, `reqwest`-free
//! data; `send` is the only place it becomes a real `HeaderMap`. This is
//! exactly what `check_egress_chokepoint`'s source-import check exists to
//! catch, and it did — see `docs/DECISIONS.md`'s Phase 12 step 3A entry.

use std::time::Duration;

use once_cell::sync::Lazy;
use reqwest::blocking::Client;
use reqwest::StatusCode;

use crate::ai::endpoint::ResolvedEndpoint;
use crate::ai::permit::EgressPermit;
use crate::ai::pipeline::{SendApproval, TraceKind};
use crate::ai::prompt::PromptSpec;
use crate::error::AppError;

/// Plain header name/value pairs an adapter wants sent — never
/// `reqwest::header::HeaderMap` (see this module's doc comment). No
/// validation happens here; `send` validates while converting to a real
/// `HeaderMap` and maps a malformed name/value to `E_AI_KEY_INVALID`
/// (the only header adapters build today is the auth header).
#[derive(Debug, Clone, Default)]
pub struct RequestHeaders(Vec<(String, String)>);

impl RequestHeaders {
    pub fn new() -> Self {
        RequestHeaders(Vec::new())
    }

    pub fn insert(&mut self, name: impl Into<String>, value: impl Into<String>) {
        self.0.push((name.into(), value.into()));
    }
}

fn build_header_map(
    headers: &RequestHeaders,
    provider_label: &str,
) -> Result<reqwest::header::HeaderMap, AppError> {
    let mut map = reqwest::header::HeaderMap::new();
    for (name, value) in &headers.0 {
        let header_name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
            .map_err(|err| AppError::ai_key_invalid(provider_label, err.to_string()))?;
        let header_value = reqwest::header::HeaderValue::from_str(value)
            .map_err(|err| AppError::ai_key_invalid(provider_label, err.to_string()))?;
        map.insert(header_name, header_value);
    }
    Ok(map)
}

/// The exactly-two request-body shapes §3 non-goal 2 caps v1 at ("DeepSeek,
/// OpenAI, Azure, Bedrock, or any adapter beyond Anthropic and Ollama").
/// Adapters name their shape; they never build or supply the body itself —
/// see this module's doc comment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderShape {
    Anthropic,
    Ollama,
}

const ANTHROPIC_MAX_TOKENS: u32 = 1024;

/// Every redacted snippet becomes its own content block, and the prompt's
/// `subject` (if any) becomes one more — `text` (the snippet's own
/// already-redacted content, verbatim) is never concatenated with the task
/// copy, the subject, or any other string, so each JSON string leaf in the
/// final body is either exactly one snippet's content, exactly one
/// snippet's path, exactly the validated subject, or a fixed scaffolding
/// literal — nothing is ever glued together into a leaf that could hide
/// extra content inside a larger string. (`tests::a_planted_secret_...` in
/// `ai/anthropic.rs` and `ai/ollama.rs` walk every leaf of a real received
/// body and assert exactly this.)
fn build_content_blocks(prompt: &PromptSpec) -> Vec<serde_json::Value> {
    let mut blocks: Vec<serde_json::Value> = Vec::new();
    if let Some(subject) = prompt.subject() {
        blocks.push(serde_json::json!({ "type": "text", "subject": subject }));
    }
    blocks.extend(
        prompt
            .payload()
            .to_request_snippets()
            .into_iter()
            .map(|snippet| {
                serde_json::json!({
                    "type": "text",
                    "path": snippet.path,
                    "startLine": snippet.start_line,
                    "endLine": snippet.end_line,
                    "text": snippet.content,
                })
            }),
    );
    blocks
}

/// The only place any provider request body is built. `prompt` is the only
/// source of content (its fixed task copy, its validated subject, and its
/// redacted snippets); `shape`/`model` are plain, non-content scaffolding.
pub(crate) fn build_body(
    shape: ProviderShape,
    model: &str,
    prompt: &PromptSpec,
) -> serde_json::Value {
    let blocks = build_content_blocks(prompt);
    let task = prompt.task();
    match shape {
        ProviderShape::Anthropic => serde_json::json!({
            "model": model,
            "max_tokens": ANTHROPIC_MAX_TOKENS,
            "system": task,
            "messages": [{ "role": "user", "content": blocks }],
        }),
        ProviderShape::Ollama => serde_json::json!({
            "model": model,
            "stream": false,
            "messages": [
                { "role": "system", "content": task },
                { "role": "user", "content": blocks },
            ],
        }),
    }
}

/// `#[cfg(test)]`-only re-export of [`build_body`], so `ai::transcript`'s
/// tests can assert the transcript records the EXACT body `send` builds by
/// calling the very same function rather than re-deriving it. Production
/// code never needs this — `transcript::record` already calls `build_body`
/// directly (both live in this crate).
#[cfg(test)]
pub(crate) fn build_body_for_test(
    shape: ProviderShape,
    model: &str,
    prompt: &PromptSpec,
) -> serde_json::Value {
    build_body(shape, model, prompt)
}

/// Section 12: "per-request timeout 60s, no automatic retry on 429/5xx."
pub const AI_REQUEST_TIMEOUT_SECS: u64 = 60;

/// The one `reqwest::Client` in the repository. `reqwest`'s blocking client
/// runs its own internal async runtime privately — nothing outside this
/// module needs to become async because of it (this crate has no `tokio`
/// direct dependency anywhere else, by design — Phase 6's sidecar RPC is
/// plain `std::process`/`std::thread`).
static HTTP_CLIENT: Lazy<Client> = Lazy::new(|| {
    Client::builder()
        .timeout(Duration::from_secs(AI_REQUEST_TIMEOUT_SECS))
        .build()
        .expect("reqwest client (rustls-tls, no default features) must build")
});

/// A successful response: the raw response body text, handed back for the
/// caller to parse per-provider. This module does no provider-specific
/// *response* parsing — that stays in each adapter.
pub struct AiResponse {
    pub body: String,
}

/// The only function in this crate that sends bytes over the network.
///
/// `_permit` proves AI is on (Section 12); `endpoint` is a
/// [`ResolvedEndpoint`] — obtainable only from
/// [`crate::ai::endpoint::resolve`], never a caller argument; `headers` is
/// plain, `reqwest`-free data (see this module's doc comment); `shape`/
/// `model` select and parameterize the body `send` builds itself;
/// `prompt` is the only source of the body's content, and is itself only
/// constructible from a `RedactedPayload` (see `ai::prompt`). There is no
/// way to reach the network with content that did not come from `prompt`,
/// because `send` never accepts a body from its caller at all.
pub fn send(
    _permit: &EgressPermit,
    approval: SendApproval,
    expected_kind: TraceKind,
    endpoint: &ResolvedEndpoint,
    headers: &RequestHeaders,
    shape: ProviderShape,
    model: &str,
    prompt: &PromptSpec,
) -> Result<AiResponse, AppError> {
    // Consumed BY VALUE: one approval, one request. A borrowed token would
    // prove only that some gate passed at some point, letting a single mint
    // authorise N sends — including one issued after a later gate would have
    // refused.
    //
    // The kind check is the other half: trace orders being disjoint achieves
    // nothing if their tokens are interchangeable. A connectivity approval is
    // minted after five steps with no Redacted and no Capped, so without this
    // it would authorise a full feature payload.
    if approval.kind() != expected_kind {
        return Err(AppError::ai_pipeline_incomplete(format!(
            "send refused: approval minted for {:?} but this is a {expected_kind:?} request",
            approval.kind()
        )));
    }
    let body = build_body(shape, model, prompt);
    let header_map = build_header_map(headers, "the AI provider")?;

    let response = HTTP_CLIENT
        .post(endpoint.url())
        .headers(header_map)
        .json(&body)
        .send()
        .map_err(map_transport_error)?;

    let status = response.status();
    let body_text = response.text().unwrap_or_default();

    if !status.is_success() {
        return Err(map_http_error("the AI provider", status, &body_text));
    }
    Ok(AiResponse { body: body_text })
}

/// `reqwest::Error` has no public constructor, so no test can synthesize
/// one — `send`'s own `.map_err(map_transport_error)` above is what's
/// actually exercised at runtime; this function's OWN logic (never putting
/// `raw_detail` in `.message`) is proven by `build_network_error`'s tests
/// below, which it delegates to immediately.
fn map_transport_error(err: reqwest::Error) -> AppError {
    build_network_error(err.is_timeout(), err.to_string())
}

fn build_network_error(is_timeout: bool, raw_detail: String) -> AppError {
    AppError::ai_network(is_timeout, raw_detail)
}

/// Section 10's literal per-status copy, dispatched by status code. `body`
/// (the provider's raw response text) NEVER reaches `.message` — only
/// `.detail`, via each `AppError::ai_*` constructor.
fn map_http_error(provider_label: &str, status: StatusCode, body: &str) -> AppError {
    match status {
        StatusCode::UNAUTHORIZED => AppError::ai_key_invalid(provider_label, body.to_string()),
        StatusCode::NOT_FOUND => {
            AppError::ai_model_not_found(provider_label, "(unknown)", body.to_string())
        }
        StatusCode::TOO_MANY_REQUESTS => {
            AppError::ai_rate_limited(provider_label, None, body.to_string())
        }
        _ => build_network_error(false, format!("HTTP {status}: {body}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_network_error_never_puts_raw_detail_in_message() {
        let raw = "connection refused: os error 10061, secret-looking-token-abc123";
        let err = build_network_error(false, raw.to_string());
        assert_eq!(err.code, "E_AI_NETWORK");
        assert!(
            !err.message.contains(raw),
            "raw transport text leaked into message: {}",
            err.message
        );
        assert_eq!(err.detail.as_deref(), Some(raw));
    }

    #[test]
    fn build_network_error_distinguishes_timeout_in_message_copy() {
        let timeout_err = build_network_error(true, "elapsed".to_string());
        assert!(timeout_err.message.contains("timed out"));
        let other_err = build_network_error(false, "elapsed".to_string());
        assert!(!other_err.message.contains("timed out"));
    }

    #[test]
    fn map_http_error_401_never_puts_the_response_body_in_message() {
        let body = "{\"error\":{\"message\":\"invalid_api_key: sk-verysecretvalue\"}}";
        let err = map_http_error("anthropic", StatusCode::UNAUTHORIZED, body);
        assert_eq!(err.code, "E_AI_KEY_INVALID");
        assert!(!err.message.contains("sk-verysecretvalue"));
        assert_eq!(err.detail.as_deref(), Some(body));
    }

    #[test]
    fn map_http_error_429_never_puts_the_response_body_in_message() {
        let body = "rate limit exceeded, retry-after=30, account=acct_secret123";
        let err = map_http_error("anthropic", StatusCode::TOO_MANY_REQUESTS, body);
        assert_eq!(err.code, "E_AI_RATE_LIMITED");
        assert!(!err.message.contains("acct_secret123"));
        assert_eq!(err.detail.as_deref(), Some(body));
    }

    #[test]
    fn map_http_error_404_never_puts_the_response_body_in_message() {
        let body = "model \"claude-9\" not found for key sk-ant-hidden";
        let err = map_http_error("anthropic", StatusCode::NOT_FOUND, body);
        assert_eq!(err.code, "E_AI_MODEL_NOT_FOUND");
        assert!(!err.message.contains("sk-ant-hidden"));
        assert_eq!(err.detail.as_deref(), Some(body));
    }

    #[test]
    fn map_http_error_other_status_never_puts_the_response_body_in_message() {
        let body = "internal error, session=eyJhbGciOiJIUzI1NiJ9.secret.sig";
        let err = map_http_error("anthropic", StatusCode::INTERNAL_SERVER_ERROR, body);
        assert_eq!(err.code, "E_AI_NETWORK");
        assert!(!err.message.contains("eyJhbGciOiJIUzI1NiJ9"));
        assert!(err.detail.unwrap().contains(body));
    }

    #[test]
    fn request_timeout_constant_matches_section_12() {
        assert_eq!(AI_REQUEST_TIMEOUT_SECS, 60);
    }

    pub(super) fn prompt_from(
        feature: crate::ai::prompt::AiFeature,
        path: &str,
        content: &str,
    ) -> PromptSpec {
        let payload = crate::privacy::redact::redact(
            &crate::contract::EngineSnippetsResult {
                snippets: vec![crate::contract::EngineSnippet {
                    path: path.to_string(),
                    start_line: 1,
                    end_line: 1,
                    content: content.to_string(),
                }],
            },
            &[],
        )
        .expect("redacting a plain non-secret line cannot fail");
        crate::ai::prompt::build(feature, payload)
    }

    #[test]
    fn build_body_never_concatenates_a_snippets_content_with_the_instructions() {
        let prompt = prompt_from(
            crate::ai::prompt::AiFeature::ProjectSummary,
            "a.ts",
            "const x = 1;",
        );
        let body = build_body(ProviderShape::Anthropic, "test-model", &prompt);
        let content_text = body["messages"][0]["content"][0]["text"]
            .as_str()
            .expect("content block must carry a plain text leaf");
        assert_eq!(
            content_text, "const x = 1;",
            "the snippet's content must appear as its OWN leaf, not glued to instructions"
        );
    }

    /// The subject (a user's question, or a module id) is its own leaf in
    /// its own block — never appended to the task copy, and never glued to
    /// a snippet's content.
    #[test]
    fn build_body_gives_the_prompt_subject_its_own_leaf() {
        let prompt = prompt_from(
            crate::ai::prompt::AiFeature::Question(
                crate::ai::prompt::UserQuestion::parse("where is auth?").unwrap(),
            ),
            "a.ts",
            "const x = 1;",
        );
        let body = build_body(ProviderShape::Anthropic, "test-model", &prompt);
        assert_eq!(
            body["messages"][0]["content"][0]["subject"],
            "where is auth?"
        );
        assert_eq!(body["messages"][0]["content"][1]["text"], "const x = 1;");
        assert!(
            !body["system"]
                .as_str()
                .expect("system copy is a string")
                .contains("where is auth?"),
            "the question must not be concatenated into the task copy"
        );
    }

    #[test]
    fn build_body_produces_the_two_named_shapes_without_panicking() {
        for shape in [ProviderShape::Anthropic, ProviderShape::Ollama] {
            let prompt = prompt_from(
                crate::ai::prompt::AiFeature::ProjectSummary,
                "a.ts",
                "const x = 1;",
            );
            let body = build_body(shape, "test-model", &prompt);
            assert_eq!(body["model"], "test-model");
        }
    }
}

/// Shared by every adapter's own real-bytes redaction test
/// (`ai::anthropic::tests`, `ai::ollama::tests`)
/// — `pub(crate)` so those sibling modules can use it, `#[cfg(test)]` so
/// none of it exists in a non-test build.
#[cfg(test)]
pub(crate) mod test_support {
    use crate::ai::prompt::ALL_TASK_STRINGS;
    use crate::privacy::redact::RequestSnippet;
    use std::collections::HashSet;

    /// Fixed, non-content scaffolding literals that legitimately appear as
    /// string leaves (or JSON object field names) in ANY of the three
    /// shapes' outbound bodies — including every fixed per-feature task
    /// string `ai::prompt` can produce (they are `&'static str` constants
    /// chosen by `prompt::build`, never caller-authored). Deliberately does
    /// NOT include the model id (varies per call), the prompt's `subject`
    /// (varies per request), or any snippet path/content (varies per
    /// payload) — [`assert_body_contains_nothing_beyond_scaffolding_and_snippets`]
    /// adds those separately, from the real values a test actually used.
    fn fixed_scaffolding_leaves() -> HashSet<&'static str> {
        let mut leaves: HashSet<&'static str> = [
            "model",
            "max_tokens",
            "system",
            "messages",
            "role",
            "user",
            "content",
            "type",
            "text",
            "path",
            "subject",
            "startLine",
            "endLine",
            "stream",
        ]
        .into_iter()
        .collect();
        leaves.extend(ALL_TASK_STRINGS.iter().copied());
        leaves
    }

    /// Recursively collects every JSON string leaf AND every object field
    /// name in `value` — field names count too (the owner's Phase 12 step
    /// 3A ruling explicitly names "field names" as part of the allow-set
    /// exercise, so a future body-shape change that adds an unexpected key
    /// must fail this walk, not just an unexpected value).
    fn collect_string_leaves(value: &serde_json::Value, out: &mut Vec<String>) {
        match value {
            serde_json::Value::String(s) => out.push(s.clone()),
            serde_json::Value::Array(items) => {
                for item in items {
                    collect_string_leaves(item, out);
                }
            }
            serde_json::Value::Object(map) => {
                for (key, val) in map {
                    out.push(key.clone());
                    collect_string_leaves(val, out);
                }
            }
            _ => {}
        }
    }

    /// The strengthened real-bytes assertion: every string leaf (and every
    /// object field name) in a REAL received body must be either fixed
    /// scaffolding, the model id actually used, or one of `expected_snippets`'
    /// own `path`/`content` values — nothing else. A future body-shape
    /// change that smuggles in an extra field or an unrelated string
    /// breaks this test instead of passing quietly (the previous version
    /// of this check only asserted the redacted content appeared
    /// *somewhere*, which a body containing EXTRA unredacted material
    /// alongside it would have passed).
    pub(crate) fn assert_body_contains_nothing_beyond_scaffolding_and_snippets(
        received_json: &serde_json::Value,
        model: &str,
        expected_snippets: &[RequestSnippet],
        expected_subject: Option<&str>,
    ) {
        let mut leaves = Vec::new();
        collect_string_leaves(received_json, &mut leaves);

        let mut allowed = fixed_scaffolding_leaves();
        allowed.insert(model);
        if let Some(subject) = expected_subject {
            allowed.insert(subject);
        }
        let snippet_paths: HashSet<&str> =
            expected_snippets.iter().map(|s| s.path.as_str()).collect();
        let snippet_contents: HashSet<&str> = expected_snippets
            .iter()
            .map(|s| s.content.as_str())
            .collect();

        for leaf in &leaves {
            let is_allowed = allowed.contains(leaf.as_str())
                || snippet_paths.contains(leaf.as_str())
                || snippet_contents.contains(leaf.as_str());
            assert!(
                is_allowed,
                "unexpected string leaf in the outbound body: {leaf:?} — not fixed scaffolding, \
                 not the model id ({model:?}), not a redacted snippet's own path/content. \
                 Full body: {received_json}"
            );
        }
    }
}
