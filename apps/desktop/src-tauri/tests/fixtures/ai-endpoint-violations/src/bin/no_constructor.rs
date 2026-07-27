// MUST NOT COMPILE: there is no `ResolvedEndpoint::new` — must fail with
// E0599 ("no function or associated item named `new` found").
fn main() {
    let _endpoint = onboard_lib::ai::endpoint::ResolvedEndpoint::new("https://evil.example.com");
}
