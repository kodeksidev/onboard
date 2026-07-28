// MUST NOT COMPILE: `PromptSpec` does not implement `serde::Deserialize` —
// deriving it would make the type constructible from arbitrary JSON by any
// module regardless of field privacy (see `privacy::redact`'s doc comment
// for the full explanation). Must fail with E0277.
fn main() {
    let _spec: onboard_lib::ai::prompt::PromptSpec = serde_json::from_str("{}").unwrap();
}
