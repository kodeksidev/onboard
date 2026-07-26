// MUST NOT COMPILE: `RedactedPayload` does not implement `Default` — must
// fail with E0277 ("the trait bound `RedactedPayload: Default` is not
// satisfied").
fn main() {
    let _payload: onboard_lib::privacy::redact::RedactedPayload = Default::default();
}
