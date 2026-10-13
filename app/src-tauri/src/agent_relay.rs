// Lets an external agent drive this desktop app. The process listens on a
// loopback port and records the port and a per-launch token in
// agent-relay.json in the app data folder, where the relay
// (app/scripts/agent-relay) finds them. Each connection sends one JSON
// request per line, `{"token": ..., "request": {"method": "list" | "call",
// "name": ..., "arguments": {...}}}`, and gets one JSON response per line,
// `{"ok": true, "result": ...}` or `{"ok": false, "error": {"message": ...}}`.
// Requests reach the main window as an `agent-relay:request` event, and the
// window answers through `agent_relay_respond` (src/agent-relay/desktop.ts).

use serde_json::{json, Value};
use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

pub const DISCOVERY_FILE: &str = "agent-relay.json";
pub const REQUEST_EVENT: &str = "agent-relay:request";
// Long enough for a command such as an export to finish.
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(15 * 60);

pub type Forward = dyn Fn(Value) -> Result<(), String> + Send + Sync;

pub struct AgentRelay {
  token: String,
  next_id: AtomicU64,
  ready: AtomicBool,
  pending: Mutex<HashMap<u64, Sender<Value>>>,
  response_timeout: Duration,
}

fn error_response(message: impl Into<String>) -> Value {
  json!({ "ok": false, "error": { "message": message.into() } })
}

fn random_token() -> String {
  let mut token = String::new();
  for _ in 0..2 {
    let mut hasher = RandomState::new().build_hasher();
    hasher.write_u128(
      std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or_default(),
    );
    hasher.write_u32(std::process::id());
    token.push_str(&format!("{:016x}", hasher.finish()));
  }
  token
}

impl AgentRelay {
  pub fn new(token: String, response_timeout: Duration) -> Self {
    Self {
      token,
      next_id: AtomicU64::new(1),
      ready: AtomicBool::new(false),
      pending: Mutex::new(HashMap::new()),
      response_timeout,
    }
  }

  pub fn token(&self) -> &str {
    &self.token
  }

  pub fn set_ready(&self, ready: bool) {
    self.ready.store(ready, Ordering::SeqCst);
  }

  /// Delivers the window's answer to the connection waiting on `id`.
  pub fn respond(&self, id: u64, response: Value) {
    let sender = self.pending.lock().unwrap().remove(&id);
    if let Some(sender) = sender {
      let _ = sender.send(response);
    }
  }

  /// Answers one request line, forwarding valid requests to the window.
  pub fn handle_line(&self, line: &str, forward: &Forward) -> Value {
    let Ok(message) = serde_json::from_str::<Value>(line) else {
      return error_response("The request is not valid JSON.");
    };
    if message.get("token").and_then(Value::as_str) != Some(self.token.as_str()) {
      return error_response("The relay token does not match this zvid desktop app.");
    }
    let Some(request) = message.get("request").and_then(Value::as_object) else {
      return error_response("The message has no request.");
    };
    if !self.ready.load(Ordering::SeqCst) {
      return error_response("The zvid window is still starting up. Try again in a moment.");
    }

    let id = self.next_id.fetch_add(1, Ordering::SeqCst);
    let (sender, receiver) = mpsc::channel();
    self.pending.lock().unwrap().insert(id, sender);
    let mut payload = request.clone();
    payload.insert("id".into(), json!(id));
    if let Err(error) = forward(Value::Object(payload)) {
      self.pending.lock().unwrap().remove(&id);
      return error_response(format!("Could not reach the zvid window: {error}"));
    }
    match receiver.recv_timeout(self.response_timeout) {
      Ok(response) => response,
      Err(_) => {
        self.pending.lock().unwrap().remove(&id);
        error_response("The zvid window did not answer in time.")
      }
    }
  }

  fn serve_connection(self: &Arc<Self>, stream: TcpStream, forward: &Forward) {
    let Ok(mut writer) = stream.try_clone() else {
      return;
    };
    for line in BufReader::new(stream).lines() {
      let Ok(line) = line else {
        return;
      };
      if line.trim().is_empty() {
        continue;
      }
      let response = self.handle_line(&line, forward);
      if writeln!(writer, "{response}").is_err() {
        return;
      }
    }
  }

  /// Accepts connections on `listener` on a background thread.
  pub fn serve(self: &Arc<Self>, listener: TcpListener, forward: Arc<Forward>) {
    let relay = Arc::clone(self);
    thread::spawn(move || {
      for stream in listener.incoming().flatten() {
        let relay = Arc::clone(&relay);
        let forward = Arc::clone(&forward);
        thread::spawn(move || relay.serve_connection(stream, forward.as_ref()));
      }
    });
  }
}

pub fn write_discovery_file(dir: &Path, port: u16, token: &str) -> std::io::Result<PathBuf> {
  std::fs::create_dir_all(dir)?;
  let path = dir.join(DISCOVERY_FILE);
  let contents = json!({ "port": port, "token": token, "pid": std::process::id() });
  #[cfg(unix)]
  {
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = std::fs::OpenOptions::new()
      .write(true)
      .create(true)
      .truncate(true)
      .mode(0o600)
      .open(&path)?;
    file.write_all(contents.to_string().as_bytes())?;
  }
  #[cfg(not(unix))]
  std::fs::write(&path, contents.to_string())?;
  Ok(path)
}

/// Starts listening for the relay and records where in `data_dir`.
pub fn start(data_dir: &Path, forward: Arc<Forward>) -> std::io::Result<(Arc<AgentRelay>, PathBuf)> {
  let listener = TcpListener::bind(("127.0.0.1", 0))?;
  let port = listener.local_addr()?.port();
  let relay = Arc::new(AgentRelay::new(random_token(), RESPONSE_TIMEOUT));
  let path = write_discovery_file(data_dir, port, relay.token())?;
  relay.serve(listener, forward);
  Ok((relay, path))
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::io::Read;

  fn ready_relay() -> Arc<AgentRelay> {
    let relay = Arc::new(AgentRelay::new("secret".into(), Duration::from_secs(5)));
    relay.set_ready(true);
    relay
  }

  // Stands in for the window: answers each forwarded request on another
  // thread, echoing what it received.
  fn echo_window(relay: &Arc<AgentRelay>) -> Arc<Forward> {
    let relay = Arc::clone(relay);
    Arc::new(move |payload: Value| {
      let relay = Arc::clone(&relay);
      thread::spawn(move || {
        let id = payload["id"].as_u64().unwrap();
        relay.respond(id, json!({ "ok": true, "result": payload }));
      });
      Ok(())
    })
  }

  #[test]
  fn forwards_requests_and_returns_the_window_answer() {
    let relay = ready_relay();
    let forward = echo_window(&relay);
    let line = r#"{"token":"secret","request":{"method":"call","name":"play","arguments":{"at":2}}}"#;

    let response = relay.handle_line(line, forward.as_ref());

    assert_eq!(response["ok"], true);
    assert_eq!(response["result"]["name"], "play");
    assert_eq!(response["result"]["arguments"]["at"], 2);
    assert!(relay.pending.lock().unwrap().is_empty());
  }

  #[test]
  fn rejects_wrong_tokens_bad_json_and_an_unready_window() {
    let relay = Arc::new(AgentRelay::new("secret".into(), Duration::from_secs(5)));
    let forward = echo_window(&relay);
    let message = |response: Value| response["error"]["message"].as_str().unwrap().to_string();

    let wrong = relay.handle_line(r#"{"token":"guess","request":{"method":"list"}}"#, forward.as_ref());
    assert!(message(wrong).contains("token"));
    let invalid = relay.handle_line("not json", forward.as_ref());
    assert!(message(invalid).contains("JSON"));
    let unready = relay.handle_line(r#"{"token":"secret","request":{"method":"list"}}"#, forward.as_ref());
    assert!(message(unready).contains("starting up"));
  }

  #[test]
  fn times_out_when_the_window_never_answers() {
    let relay = Arc::new(AgentRelay::new("secret".into(), Duration::from_millis(50)));
    relay.set_ready(true);
    let silent: Arc<Forward> = Arc::new(|_| Ok(()));

    let response = relay.handle_line(r#"{"token":"secret","request":{"method":"list"}}"#, silent.as_ref());

    assert_eq!(response["ok"], false);
    assert!(relay.pending.lock().unwrap().is_empty());
  }

  #[test]
  fn round_trips_over_the_loopback_port_and_records_it() {
    let dir = tempfile::tempdir().unwrap();
    let forward_slot: Arc<Mutex<Option<Arc<AgentRelay>>>> = Arc::new(Mutex::new(None));
    let slot = Arc::clone(&forward_slot);
    let forward: Arc<Forward> = Arc::new(move |payload: Value| {
      let relay = slot.lock().unwrap().clone().unwrap();
      let id = payload["id"].as_u64().unwrap();
      thread::spawn(move || relay.respond(id, json!({ "ok": true, "result": ["play"] })));
      Ok(())
    });
    let (relay, path) = start(dir.path(), forward).unwrap();
    *forward_slot.lock().unwrap() = Some(Arc::clone(&relay));
    relay.set_ready(true);

    let mut contents = String::new();
    std::fs::File::open(&path).unwrap().read_to_string(&mut contents).unwrap();
    let discovery: Value = serde_json::from_str(&contents).unwrap();
    assert_eq!(discovery["token"], relay.token());
    let port = discovery["port"].as_u64().unwrap() as u16;

    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    let request = json!({ "token": relay.token(), "request": { "method": "list" } });
    writeln!(stream, "{request}").unwrap();
    writeln!(stream, "{request}").unwrap();
    let mut lines = BufReader::new(stream).lines();
    for _ in 0..2 {
      let response: Value = serde_json::from_str(&lines.next().unwrap().unwrap()).unwrap();
      assert_eq!(response, json!({ "ok": true, "result": ["play"] }));
    }
  }
}
