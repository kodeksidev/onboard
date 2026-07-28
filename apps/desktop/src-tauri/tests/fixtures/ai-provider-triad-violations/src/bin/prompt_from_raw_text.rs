// MUST NOT COMPILE: `ai::prompt::build` — the ONLY producer of the
// `PromptSpec` that `ai::http::send` now takes — accepts a
// `RedactedPayload` and nothing else. Handing it raw text (the thing a
// caller would actually have if it were trying to bypass Section 8.9)
// must fail with E0308 ("mismatched types ... expected `RedactedPayload`,
// found `&str`"). This is what keeps the WHAT leg intact across the
// step-6 signature change.
fn main() {
    let raw_unredacted_content = format!(
        "const apiKey = \"{}\";",
        onboard_lib::privacy::fake_secrets::aws_example_key_id()
    );
    let _ = onboard_lib::ai::prompt::build(
        onboard_lib::ai::prompt::AiFeature::ProjectSummary,
        raw_unredacted_content,
    );
}
