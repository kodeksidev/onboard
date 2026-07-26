// MUST NOT COMPILE: there is no `RedactedPayload::new` (or any other public
// constructor) anywhere in the crate — must fail with E0599 ("no function
// or associated item named `new` found").
fn main() {
    let _payload = onboard_lib::privacy::redact::RedactedPayload::new();
}
