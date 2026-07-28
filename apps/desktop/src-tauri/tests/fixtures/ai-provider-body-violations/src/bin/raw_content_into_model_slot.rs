// MUST NOT COMPILE: the `model` parameter is `&str` — a caller cannot
// smuggle arbitrary JSON content through it. Passing a `serde_json::Value`
// (standing in for "an adapter trying to pass raw/unredacted content
// somewhere, anywhere, in the call") must fail with E0308 ("mismatched
// types ... expected `&str`, found `&serde_json::Value`").
fn main() {
    let raw_content = serde_json::json!({ "content": "raw unredacted content" });
    let _ = onboard_lib::ai::http::send(
        todo!(),
        todo!(),
        todo!(),
        todo!(),
        todo!(),
        todo!(),
        &raw_content,
        todo!(),
    );
}
