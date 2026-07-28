// MUST NOT COMPILE: an "adapter-shaped" caller with no real `PromptSpec`
// (WHAT) — here, `&()` — cannot reach the wire — must fail with E0308
// ("mismatched types ... expected `&PromptSpec`, found `&()`"). `todo!()`
// fills the other five parameters so the ONE error this file produces is
// isolated to the prompt slot (the last parameter in `send`'s signature).
//
// Phase 12 step 6 changed this slot from `&RedactedPayload` to
// `&PromptSpec`, which does NOT weaken the WHAT leg: a `PromptSpec` has
// private fields, no public constructor, and `ai::prompt::build` — its only
// producer — takes a `RedactedPayload`. `prompt_from_raw_text.rs`, next to
// this file, proves that second half.
fn main() {
    let fake_payload = ();
    let _ = onboard_lib::ai::http::send(
        todo!(),
        todo!(),
        todo!(),
        todo!(),
        todo!(),
        todo!(),
        todo!(),
        &fake_payload,
    );
}
