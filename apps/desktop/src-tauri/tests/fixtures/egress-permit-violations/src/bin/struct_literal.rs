// MUST NOT COMPILE: `EgressPermit`'s `provider` field is private — must
// fail with E0451 ("field `provider` of struct `..EgressPermit` is
// private").
fn main() {
    let _permit = onboard_lib::ai::permit::EgressPermit {
        provider: onboard_lib::commands::settings::AiProvider::Anthropic,
    };
}
