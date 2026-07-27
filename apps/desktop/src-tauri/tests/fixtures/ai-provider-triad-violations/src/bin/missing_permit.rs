// MUST NOT COMPILE: an "adapter-shaped" caller with no real `EgressPermit`
// (WHETHER) cannot reach the wire — must fail with E0308 ("mismatched
// types ... expected `&EgressPermit`, found `&()`"). `todo!()` fills the
// other five parameters so the ONE error this file produces is isolated to
// the permit slot.
fn main() {
    let fake_permit = ();
    let _ = onboard_lib::ai::http::send(
        &fake_permit,
        todo!(),
        todo!(),
        todo!(),
        todo!(),
        todo!(),
    );
}
