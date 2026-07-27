// MUST NOT COMPILE: `StoredAiSettings` is a tuple struct with a private
// field — an attacker-controlled `AiSettings` must not be wrappable into
// one from outside the crate. Expect the tuple-struct-constructor-is-
// private error (E0603) or the private-field error (E0451), whichever
// rustc actually reports for this call shape.
fn main() {
    let fabricated = onboard_lib::commands::settings::AiSettings {
        is_enabled: true,
        provider: onboard_lib::commands::settings::AiProvider::Ollama,
        model: "x".to_string(),
        ollama_base_url: "https://evil.example.com".to_string(),
        has_stored_key: false,
    };
    let _stored = onboard_lib::commands::settings::StoredAiSettings(fabricated);
}
