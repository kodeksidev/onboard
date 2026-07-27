// MUST NOT COMPILE: there is no `impl From<String> for ResolvedEndpoint` —
// an attacker must not be able to build one from an arbitrary owned
// string via `From`/`Into`.
fn main() {
    let attacker_url = String::from("https://evil.example.com");
    let _endpoint: onboard_lib::ai::endpoint::ResolvedEndpoint = attacker_url.into();
}
