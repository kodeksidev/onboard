//! Stub sidecar for Phase 6 tests. Speaks the exact Section 7.3
//! newline-delimited JSON-RPC 2.0 protocol over stdio and replays
//! `packages/contract/fixtures/sample-analysis.json` for `engine.analyze`.
//! Not shipped: this binary exists only so `cargo test` can drive
//! `sidecar::supervisor` and `sidecar::rpc` against something real without
//! depending on the Phase 5 engine binary, which does not exist yet.
//!
//! Behavior toggles are passed as plain `KEY=VALUE` argv entries (never
//! env vars) so parallel `cargo test` threads each get an isolated,
//! deterministic process:
//!   - `CRASH_ON=<method>`      exit(1) immediately on that method, no reply
//!   - `MALFORMED_ON=<method>`  print one invalid JSON line, then exit
//!   - `HANG_ON=<method>`       never reply to that method (sleeps)
//!   - `VERSION_MISMATCH=1`     `engine.version` reports a wrong schema version

use std::collections::HashMap;
use std::io::{self, BufRead, Write};
use std::time::Duration;

use serde_json::{json, Value};

/// The fixture Phase 1 froze for exactly this purpose (Section 9, Phase 1:
/// "which is what the UI develops against for Phases 7-10" — the sidecar
/// stub reuses it so Phase 6 exercises a real, schema-valid envelope).
const SAMPLE_ANALYSIS_ENVELOPE: &str =
    include_str!("../../../../../packages/contract/fixtures/sample-analysis.json");

fn main() {
    let toggles = parse_toggles(std::env::args().skip(1));
    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(request) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let id = request.get("id").cloned();
        let method = request
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();

        if toggles.get("CRASH_ON").map(String::as_str) == Some(method.as_str()) {
            std::process::exit(1);
        }
        if toggles.get("MALFORMED_ON").map(String::as_str) == Some(method.as_str()) {
            let _ = writeln!(stdout, "this is not valid json-rpc");
            let _ = stdout.flush();
            std::process::exit(1);
        }
        if toggles.get("HANG_ON").map(String::as_str) == Some(method.as_str()) {
            loop {
                std::thread::sleep(Duration::from_secs(3600));
            }
        }

        let Some(id) = id else { continue }; // notifications need no reply
        let result = handle(
            &method,
            request.get("params").cloned().unwrap_or(Value::Null),
            &toggles,
        );
        let response = json!({ "jsonrpc": "2.0", "id": id, "result": result });
        let _ = writeln!(stdout, "{response}");
        let _ = stdout.flush();

        if method == "engine.shutdown" {
            return;
        }
    }
}

fn parse_toggles<I: Iterator<Item = String>>(args: I) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for arg in args {
        if let Some((key, value)) = arg.split_once('=') {
            map.insert(key.to_string(), value.to_string());
        }
    }
    map
}

fn handle(method: &str, _params: Value, toggles: &HashMap<String, String>) -> Value {
    match method {
        "engine.version" => {
            let contract_schema_version = if toggles.contains_key("VERSION_MISMATCH") {
                999
            } else {
                1
            };
            json!({
                "engineVersion": "0.0.0-stub",
                "contractSchemaVersion": contract_schema_version,
                "grammarFingerprint": "stub-fingerprint",
            })
        }
        "engine.analyze" => serde_json::from_str::<Value>(SAMPLE_ANALYSIS_ENVELOPE)
            .expect("sample-analysis.json must be valid JSON"),
        "engine.search" => json!({
            "query": "stub",
            "expandedTerms": [],
            "droppedTerms": [],
            "hits": [],
            "totalCandidateCount": 0,
        }),
        "engine.readFile" => json!({
            "path": "stub.ts",
            "language": "ts",
            "lineCount": 0,
            "isTruncated": false,
            "content": "",
        }),
        "engine.snippets" => json!({ "snippets": [] }),
        "engine.shutdown" => json!({}),
        _ => Value::Null,
    }
}
