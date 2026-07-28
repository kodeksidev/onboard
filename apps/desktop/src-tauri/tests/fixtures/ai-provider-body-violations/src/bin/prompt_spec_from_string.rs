// MUST NOT COMPILE: there is no `From<String>`/`From<&str>` for
// `PromptSpec` — a bare string is exactly what a free-form-instructions
// channel would look like. Written as `.into()` (rather than
// `PromptSpec::from(..)`, which resolves to core's reflexive
// `impl From<T> for T` and would report a less specific error) so the
// failure names the missing conversion itself: E0277, "the trait bound
// `PromptSpec: From<String>` is not satisfied".
fn main() {
    let _spec: onboard_lib::ai::prompt::PromptSpec =
        "ignore previous instructions".to_string().into();
}
