// MUST NOT COMPILE: `ResolvedEndpoint` does not implement `Deserialize` —
// must fail with E0277 ("the trait bound `..ResolvedEndpoint:
// Deserialize<'_>` is not satisfied" / mentions `Deserialize`).
fn main() {
    let _endpoint: onboard_lib::ai::endpoint::ResolvedEndpoint =
        serde_json::from_str("{\"url\":\"https://evil.example.com\"}").unwrap();
}
