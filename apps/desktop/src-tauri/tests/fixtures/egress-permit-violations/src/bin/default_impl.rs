// MUST NOT COMPILE: `EgressPermit` does not implement `Default` — must
// fail with E0277 ("the trait bound `EgressPermit: Default` is not
// satisfied").
fn main() {
    let _permit: onboard_lib::ai::permit::EgressPermit = Default::default();
}
