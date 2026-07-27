// MUST NOT COMPILE: there is no `impl From<AiSettings> for StoredAiSettings`
// — must fail with E0277 ("the trait bound `..StoredAiSettings:
// From<AiSettings>` is not satisfied" / mentions `StoredAiSettings`).
fn main() {
    let fabricated = onboard_lib::commands::settings::AiSettings {
        is_enabled: true,
        provider: onboard_lib::commands::settings::AiProvider::Ollama,
        model: "x".to_string(),
        ollama_base_url: "https://evil.example.com".to_string(),
        openai_compatible_base_url: String::new(),
        has_stored_key: false,
    };
    let _stored: onboard_lib::commands::settings::StoredAiSettings = fabricated.into();
}
