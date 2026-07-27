// MUST NOT COMPILE: `ai::http::send`'s first parameter is `&EgressPermit`
// specifically — passing anything else (here, `&()`, since no other value
// of the right type is obtainable at all, which is the whole point) must
// fail with E0308 ("mismatched types ... expected `&EgressPermit`, found
// `&()`"). The other five arguments use `todo!()` (type `!`, unifies with
// anything) so the ONE error this file produces is isolated to the permit
// parameter, not noise from also being unable to build a `RedactedPayload`.
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
