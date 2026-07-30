// MUST NOT COMPILE: the OLD `send(.., endpoint: &str, ..)` call shape must
// be gone entirely, not merely unused — must fail with E0308 ("mismatched
// types ... expected `&ResolvedEndpoint`, found `&str`" / mentions
// `ResolvedEndpoint`).
//
// `todo!()` (type `!`) fills every OTHER parameter so the single error this
// file produces is isolated to the endpoint argument. The count must track
// `send`'s real arity: when the pipeline's `SendApproval` and `TraceKind`
// parameters were added, an out-of-date list here made this fixture fail
// with E0061 (wrong number of arguments) instead — still "does not
// compile", but for a reason that has nothing to do with the endpoint type
// this file exists to assert. A compile-fail test that fails for the wrong
// reason is a passing test that checks nothing.
fn main() {
    let _ = onboard_lib::ai::http::send(
        todo!(),
        todo!(),
        todo!(),
        "https://evil.example.com",
        todo!(),
        todo!(),
        todo!(),
        todo!(),
    );
}
