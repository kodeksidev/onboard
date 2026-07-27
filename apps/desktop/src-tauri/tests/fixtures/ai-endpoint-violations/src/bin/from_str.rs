// MUST NOT COMPILE: there is no `impl From<&str> for ResolvedEndpoint` —
// an attacker must not be able to build one from an arbitrary string
// literal via `From`/`Into`.
fn main() {
    let _endpoint: onboard_lib::ai::endpoint::ResolvedEndpoint = "https://evil.example.com".into();
}
