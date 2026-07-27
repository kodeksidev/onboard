//! Section 12 lockdown assertions: the CSP has no remote origin and the
//! capability file grants no `http:` (and no `fs:`) permission. These read
//! the actual shipped config files rather than a copy, so drift is caught.

use std::path::Path;

fn read_config_file(relative: &str) -> String {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(manifest_dir.join(relative))
        .unwrap_or_else(|err| panic!("failed to read {relative}: {err}"))
}

#[test]
fn the_csp_declares_no_remote_origin() {
    let config: serde_json::Value =
        serde_json::from_str(&read_config_file("tauri.conf.json")).unwrap();
    let csp = config["app"]["security"]["csp"]
        .as_str()
        .expect("tauri.conf.json must declare app.security.csp");

    assert!(csp.contains("default-src 'self'"));
    assert!(csp.contains("connect-src 'self' ipc: http://ipc.localhost"));
    // No scheme other than the local ipc bridge and `'self'`/`data:` may
    // appear — in particular no `https://` or `http://` remote origin.
    assert!(!csp.contains("https://"));
    let connect_src_only_localhost = csp
        .split("connect-src")
        .nth(1)
        .and_then(|rest| rest.split(';').next())
        .map(|directive| {
            directive
                .split_whitespace()
                .filter(|token| token.starts_with("http://") || token.starts_with("https://"))
                .all(|token| token == "http://ipc.localhost")
        })
        .unwrap_or(false);
    assert!(connect_src_only_localhost, "csp connect-src: {csp}");
}

#[test]
fn capabilities_grant_no_http_or_fs_permission() {
    let config: serde_json::Value =
        serde_json::from_str(&read_config_file("capabilities/default.json")).unwrap();
    let permissions = config["permissions"]
        .as_array()
        .expect("capabilities/default.json must declare a permissions array");

    for permission in permissions {
        let identifier = match permission {
            serde_json::Value::String(s) => s.clone(),
            serde_json::Value::Object(obj) => obj
                .get("identifier")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_string(),
            _ => String::new(),
        };
        assert!(
            !identifier.starts_with("http:"),
            "found an http: permission: {identifier}"
        );
        assert!(
            !identifier.starts_with("fs:"),
            "found an fs: permission: {identifier}"
        );
    }
}

#[test]
fn shell_execute_is_scoped_to_the_onboard_engine_binary_only() {
    let config: serde_json::Value =
        serde_json::from_str(&read_config_file("capabilities/default.json")).unwrap();
    let permissions = config["permissions"].as_array().unwrap();

    let shell_permission = permissions
        .iter()
        .find(|p| {
            p.get("identifier").and_then(serde_json::Value::as_str) == Some("shell:allow-execute")
        })
        .expect("capabilities/default.json must scope shell:allow-execute");

    let allow = shell_permission["allow"].as_array().unwrap();
    assert_eq!(allow.len(), 1, "exactly one scoped binary name is allowed");
    assert_eq!(allow[0]["name"], "onboard-engine");

    // `args: true` would let the webview pass ARBITRARY arguments to the
    // sidecar. The shell never needs that: lib.rs spawns the engine with
    // exactly ["--grammars-dir", <path>] through std::process::Command, so the
    // capability must not grant more than the app itself uses. Flagged by the
    // privacy audit as over-broad and tightened here.
    let args = &allow[0]["args"];
    assert!(
        !args.is_boolean(),
        "shell scope must not use `args: true`/`false` — enumerate the allowed arguments instead"
    );
    let args = args
        .as_array()
        .expect("shell scope args must be an explicit allow-list");
    assert_eq!(
        args.len(),
        2,
        "the engine takes exactly one flag and one value"
    );
    assert_eq!(
        args[0], "--grammars-dir",
        "the only literal argument the shell may pass"
    );
    assert!(
        args[1]
            .get("validator")
            .and_then(serde_json::Value::as_str)
            .is_some(),
        "the grammars-dir VALUE must be constrained by a validator, not free-form"
    );
}

#[test]
fn devtools_cargo_feature_is_never_enabled() {
    // Devtools are opt-in via the `devtools` Cargo feature (disabled by
    // default in Tauri 2 release builds); this asserts Cargo.toml never
    // turns it on for any dependency, which would leak devtools into
    // release builds.
    let cargo_toml = read_config_file("Cargo.toml");
    assert!(!cargo_toml.contains("\"devtools\""));
}
