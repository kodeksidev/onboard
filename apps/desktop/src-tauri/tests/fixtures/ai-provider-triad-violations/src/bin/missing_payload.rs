// MUST NOT COMPILE: an "adapter-shaped" caller with no real
// `RedactedPayload` (WHAT) — here, `&()` — cannot reach the wire — must
// fail with E0308 ("mismatched types ... expected `&RedactedPayload`,
// found `&()`"). `todo!()` fills the other five parameters so the ONE
// error this file produces is isolated to the payload slot (the last
// parameter in `send`'s signature).
fn main() {
    let fake_payload = ();
    let _ = onboard_lib::ai::http::send(
        todo!(),
        todo!(),
        todo!(),
        todo!(),
        todo!(),
        &fake_payload,
    );
}
