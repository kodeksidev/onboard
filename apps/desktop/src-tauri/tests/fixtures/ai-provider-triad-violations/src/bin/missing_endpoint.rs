// MUST NOT COMPILE: an "adapter-shaped" caller with no real
// `ResolvedEndpoint` (WHERE) — here, a plain string literal — cannot reach
// the wire — must fail with E0308 ("mismatched types ... expected
// `&ResolvedEndpoint`, found `&str`"). `todo!()` fills the other four
// parameters so the ONE error this file produces is isolated to the
// endpoint slot.
fn main() {
    let _ = onboard_lib::ai::http::send(
        todo!(),
        "https://evil.example.com",
        todo!(),
        todo!(),
        todo!(),
    );
}
