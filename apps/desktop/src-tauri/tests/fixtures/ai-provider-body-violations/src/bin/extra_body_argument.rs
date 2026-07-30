// MUST NOT COMPILE: `ai::http::send` takes exactly six parameters
// (permit, endpoint, headers, shape, model, payload) — there is no
// seventh slot for a caller-built body/content argument. Passing one
// extra argument (as if the deleted `body: &serde_json::Value` parameter
// still existed) must fail with E0061 ("this function takes 6 arguments
// but 7 arguments were supplied").
fn main() {
    let _ = onboard_lib::ai::http::send(
        todo!(),
        todo!(),
        todo!(),
        todo!(),
        todo!(),
        todo!(),
        todo!(),
        todo!(),
        todo!(), // the deleted body/content argument
    );
}
