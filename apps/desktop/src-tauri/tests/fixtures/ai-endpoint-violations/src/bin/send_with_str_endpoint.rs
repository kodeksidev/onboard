// MUST NOT COMPILE: the OLD `send(.., endpoint: &str, ..)` call shape must
// be gone entirely, not merely unused — must fail with E0308 ("mismatched
// types ... expected `&ResolvedEndpoint`, found `&str`" / mentions
// `ResolvedEndpoint`). `todo!()` (type `!`) fills the other four
// parameters so the one error this file produces is isolated to the
// endpoint argument.
fn main() {
    let _ = onboard_lib::ai::http::send(todo!(), "https://evil.example.com", todo!(), todo!(), todo!());
}
