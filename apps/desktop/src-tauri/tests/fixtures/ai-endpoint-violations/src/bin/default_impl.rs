// MUST NOT COMPILE: `ResolvedEndpoint` does not implement `Default` — must
// fail with E0277 ("the trait bound `..ResolvedEndpoint: Default` is not
// satisfied").
fn main() {
    let _endpoint: onboard_lib::ai::endpoint::ResolvedEndpoint = Default::default();
}
