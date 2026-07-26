// MUST NOT COMPILE: `RedactedPayload` does not implement `serde::Deserialize`
// — must fail with E0277 ("the trait bound `..: serde::Deserialize<'_>` is
// not satisfied").
fn main() {
    let _payload: onboard_lib::privacy::redact::RedactedPayload =
        serde_json::from_str("{}").unwrap();
}
