// MUST NOT COMPILE: `PromptSpec` does not implement `Default` — must fail
// with E0277 ("the trait bound `PromptSpec: Default` is not satisfied").
fn main() {
    let _spec: onboard_lib::ai::prompt::PromptSpec = Default::default();
}
