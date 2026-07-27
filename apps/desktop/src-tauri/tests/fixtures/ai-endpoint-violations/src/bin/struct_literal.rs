// MUST NOT COMPILE: `ResolvedEndpoint`'s `url` field is private — must fail
// with E0451 ("field `url` of struct `..ResolvedEndpoint` is private").
fn main() {
    let _endpoint = onboard_lib::ai::endpoint::ResolvedEndpoint {
        url: "https://evil.example.com".to_string(),
    };
}
