// MUST NOT COMPILE: `EgressPermit` does not implement `serde::Deserialize`
// — must fail with E0277 ("the trait bound `..: serde::Deserialize<'_>` is
// not satisfied").
fn main() {
    let _permit: onboard_lib::ai::permit::EgressPermit = serde_json::from_str("{}").unwrap();
}
