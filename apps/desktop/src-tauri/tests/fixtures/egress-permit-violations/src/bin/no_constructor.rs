// MUST NOT COMPILE: there is no `EgressPermit::new` (or any other public
// constructor) — must fail with E0599 ("no function or associated item
// named `new` found").
fn main() {
    let _permit = onboard_lib::ai::permit::EgressPermit::new();
}
