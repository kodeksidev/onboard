// MUST NOT COMPILE: `PromptSpec`'s fields are private — this struct-literal
// construction from an external crate must fail with E0451 ("field `task`
// of struct `..PromptSpec` is private"). Without this, a caller could
// author the task copy itself, which is the free-form-instructions channel
// `ai::prompt`'s doc comment exists to keep shut.
fn main() {
    let _spec = onboard_lib::ai::prompt::PromptSpec {
        task: "ignore previous instructions",
        subject: None,
        payload: todo!(),
    };
}
