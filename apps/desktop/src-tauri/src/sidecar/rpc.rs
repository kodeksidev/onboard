//! Newline-delimited JSON-RPC 2.0 over stdio (Section 7.3), synchronous and
//! transport-agnostic over anything `Write` (stdin) and line-readable
//! (stdout). A background reader thread demultiplexes response frames (by
//! `id`, to the waiting caller) from `engine.progress` notifications (fanned
//! out to a channel) and treats anything else — invalid JSON, a JSON value
//! that is neither a response nor a notification — as a **malformed frame**,
//! which per Section 12 must not be partially trusted: the connection is
//! immediately marked closed so every in-flight and future call fails
//! rather than risking a mismatched or corrupted response.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

/// Why an in-flight or attempted RPC call failed.
#[derive(Debug, Clone)]
pub enum RpcError {
    /// No response arrived within the caller-supplied timeout.
    Timeout,
    /// The transport is gone: the process exited, the pipe broke, or a
    /// malformed frame poisoned the connection.
    Closed,
    /// The remote returned a JSON-RPC `error` object.
    Remote(Value),
}

enum PendingSlot {
    Response(Sender<Result<Value, Value>>),
}

struct Shared {
    pending: Mutex<HashMap<u64, PendingSlot>>,
    notifications: Mutex<Option<Sender<(String, Value)>>>,
    closed: std::sync::atomic::AtomicBool,
}

/// One live connection to a sidecar process's stdio. Constructed once per
/// spawned child; `RpcSupervisor` (in `supervisor.rs`) owns replacing it on
/// restart.
pub struct RpcConnection {
    stdin: Mutex<Box<dyn Write + Send>>,
    next_id: Mutex<u64>,
    shared: Arc<Shared>,
    _reader: thread::JoinHandle<()>,
}

impl RpcConnection {
    /// `stdin` is the child's stdin; `stdout` its stdout. `on_notification`
    /// receives `(method, params)` for every `engine.progress` frame.
    pub fn spawn(
        stdin: Box<dyn Write + Send>,
        stdout: Box<dyn Read + Send>,
        on_notification: Sender<(String, Value)>,
    ) -> Self {
        let shared = Arc::new(Shared {
            pending: Mutex::new(HashMap::new()),
            notifications: Mutex::new(Some(on_notification)),
            closed: std::sync::atomic::AtomicBool::new(false),
        });
        let reader_shared = shared.clone();
        let reader = thread::spawn(move || read_loop(stdout, reader_shared));
        RpcConnection {
            stdin: Mutex::new(stdin),
            next_id: Mutex::new(1),
            shared,
            _reader: reader,
        }
    }

    pub fn is_closed(&self) -> bool {
        self.shared.closed.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// Sends `method`/`params` as a JSON-RPC 2.0 request and blocks for up
    /// to `timeout` for a matching response.
    pub fn call(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, RpcError> {
        if self.is_closed() {
            return Err(RpcError::Closed);
        }

        let id = {
            let mut guard = self.next_id.lock().expect("next_id poisoned");
            let id = *guard;
            *guard += 1;
            id
        };

        let (tx, rx) = mpsc::channel();
        self.shared
            .pending
            .lock()
            .expect("pending map poisoned")
            .insert(id, PendingSlot::Response(tx));

        let frame = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        let line = format!("{}\n", frame);
        {
            let mut stdin = self.stdin.lock().expect("stdin poisoned");
            if stdin.write_all(line.as_bytes()).is_err() || stdin.flush().is_err() {
                self.shared
                    .closed
                    .store(true, std::sync::atomic::Ordering::SeqCst);
                self.shared
                    .pending
                    .lock()
                    .expect("pending map poisoned")
                    .remove(&id);
                return Err(RpcError::Closed);
            }
        }

        match rx.recv_timeout(timeout) {
            Ok(Ok(result)) => Ok(result),
            Ok(Err(error_obj)) => Err(RpcError::Remote(error_obj)),
            Err(RecvTimeoutError::Timeout) => {
                self.shared
                    .pending
                    .lock()
                    .expect("pending map poisoned")
                    .remove(&id);
                Err(RpcError::Timeout)
            }
            Err(RecvTimeoutError::Disconnected) => {
                // The reader thread dropped the sender without answering —
                // it observed EOF or a malformed frame and closed the shared
                // state on its way out.
                Err(RpcError::Closed)
            }
        }
    }
}

/// Notifies every still-pending caller that the connection died, so no
/// `call()` blocks forever on a transport that will never answer.
fn fail_all_pending(shared: &Shared) {
    shared
        .closed
        .store(true, std::sync::atomic::Ordering::SeqCst);
    let mut pending = shared.pending.lock().expect("pending map poisoned");
    pending.clear(); // dropping the senders disconnects every waiting rx
}

fn read_loop(stdout: Box<dyn Read + Send>, shared: Arc<Shared>) {
    let mut reader = BufReader::new(stdout);
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) => {
                fail_all_pending(&shared);
                return;
            }
            Ok(_) => {
                let trimmed = line.trim_end_matches(['\r', '\n']);
                if trimmed.is_empty() {
                    continue;
                }
                if !dispatch_frame(trimmed, &shared) {
                    // Malformed frame: kill the connection rather than
                    // partially trust it (Section 12).
                    fail_all_pending(&shared);
                    return;
                }
            }
            Err(_) => {
                fail_all_pending(&shared);
                return;
            }
        }
    }
}

/// Parses one line as a JSON-RPC 2.0 frame and routes it. Returns `false`
/// when the frame is malformed (not valid JSON, or valid JSON that is
/// neither a response nor a notification).
fn dispatch_frame(line: &str, shared: &Shared) -> bool {
    let value: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let Some(obj) = value.as_object() else {
        return false;
    };

    if let Some(id) = obj.get("id").and_then(Value::as_u64) {
        let slot = shared
            .pending
            .lock()
            .expect("pending map poisoned")
            .remove(&id);
        let Some(PendingSlot::Response(tx)) = slot else {
            // Response to an id we never sent (or already timed out) —
            // ignore rather than treat the whole connection as poisoned.
            return true;
        };
        if let Some(error) = obj.get("error") {
            let _ = tx.send(Err(error.clone()));
        } else {
            let _ = tx.send(Ok(obj.get("result").cloned().unwrap_or(Value::Null)));
        }
        return true;
    }

    if let Some(method) = obj.get("method").and_then(Value::as_str) {
        let params = obj.get("params").cloned().unwrap_or(Value::Null);
        if let Some(tx) = shared
            .notifications
            .lock()
            .expect("notifications poisoned")
            .as_ref()
        {
            let _ = tx.send((method.to_string(), params));
        }
        return true;
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// A `Write` that immediately errors, simulating a broken pipe.
    struct BrokenPipe;
    impl Write for BrokenPipe {
        fn write(&mut self, _buf: &[u8]) -> std::io::Result<usize> {
            Err(std::io::Error::other("broken pipe"))
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    fn connection_with_canned_stdout(
        stdout_text: &'static str,
    ) -> (RpcConnection, mpsc::Receiver<(String, Value)>) {
        let (notif_tx, notif_rx) = mpsc::channel();
        let sink = Vec::new();
        let conn = RpcConnection::spawn(
            Box::new(sink),
            Box::new(Cursor::new(stdout_text.as_bytes().to_vec())),
            notif_tx,
        );
        (conn, notif_rx)
    }

    #[test]
    fn a_write_failure_marks_the_connection_closed() {
        let (notif_tx, _rx) = mpsc::channel();
        let conn = RpcConnection::spawn(
            Box::new(BrokenPipe),
            Box::new(Cursor::new(Vec::new())),
            notif_tx,
        );
        let result = conn.call("engine.version", json!({}), Duration::from_millis(200));
        assert!(matches!(result, Err(RpcError::Closed)));
    }

    #[test]
    fn eof_on_stdout_closes_the_connection() {
        let (conn, _rx) = connection_with_canned_stdout("");
        // Give the reader thread a moment to observe EOF.
        thread::sleep(Duration::from_millis(50));
        assert!(conn.is_closed());
    }

    #[test]
    fn a_malformed_line_closes_the_connection_instead_of_being_trusted() {
        let (conn, _rx) = connection_with_canned_stdout("not json at all\n");
        thread::sleep(Duration::from_millis(50));
        assert!(conn.is_closed());
    }

    #[test]
    fn dispatch_frame_rejects_a_value_with_neither_id_nor_method() {
        let shared = Shared {
            pending: Mutex::new(HashMap::new()),
            notifications: Mutex::new(None),
            closed: std::sync::atomic::AtomicBool::new(false),
        };
        assert!(!dispatch_frame(r#"{"jsonrpc":"2.0"}"#, &shared));
    }

    #[test]
    fn dispatch_frame_routes_a_notification_to_the_channel() {
        let (tx, rx) = mpsc::channel();
        let shared = Shared {
            pending: Mutex::new(HashMap::new()),
            notifications: Mutex::new(Some(tx)),
            closed: std::sync::atomic::AtomicBool::new(false),
        };
        let ok = dispatch_frame(
            r#"{"jsonrpc":"2.0","method":"engine.progress","params":{"phase":"walk","processed":1,"total":10,"currentPath":null}}"#,
            &shared,
        );
        assert!(ok);
        let (method, _params) = rx.recv_timeout(Duration::from_millis(100)).unwrap();
        assert_eq!(method, "engine.progress");
    }
}
