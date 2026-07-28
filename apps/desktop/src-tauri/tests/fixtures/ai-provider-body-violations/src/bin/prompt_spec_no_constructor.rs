// MUST NOT COMPILE: there is no `PromptSpec::new` (or any other public
// constructor) — `ai::prompt::build` is the only producer — so this must
// fail with E0599 ("no function or associated item named `new` found").
fn main() {
    let _spec = onboard_lib::ai::prompt::PromptSpec::new();
}
