// MUST NOT COMPILE: `RedactedPayload`'s `files` field is private — this
// struct-literal construction from an external crate must fail with E0451
// ("field `files` of struct `..RedactedPayload` is private").
fn main() {
    let _payload = onboard_lib::privacy::redact::RedactedPayload { files: Vec::new() };
}
