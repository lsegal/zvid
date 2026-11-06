// Reads MIDI through the OS where the webview has no Web MIDI: WKWebView on
// macOS and WebKitGTK on Linux. WebView2 on Windows has Web MIDI, so this
// isn't built there. A worker thread owns the connections and polls the port
// list, since midir has no hot-plug notifications. Everything reaches the
// window over one channel, which src/midi-input/native-access.ts turns into
// the shape of Web MIDI's MIDIAccess.

use midir::{Ignore, MidiInput, MidiInputConnection};
use serde::Serialize;
use std::collections::hash_map::Entry;
use std::collections::HashMap;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

const CLIENT_NAME: &str = "zvid";
const PORT_POLL_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MidiPort {
  id: String,
  name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum MidiEvent {
  Ports { ports: Vec<MidiPort> },
  Message { port_id: String, data: Vec<u8> },
}

enum WorkerCommand {
  Open(String),
  Close(String),
}

#[derive(Default)]
pub struct MidiBackend {
  // Dropping the sender ends the worker, which closes its connections.
  worker: Mutex<Option<Sender<WorkerCommand>>>,
}

impl MidiBackend {
  fn send(&self, command: WorkerCommand) {
    if let Some(worker) = self.worker.lock().unwrap().as_ref() {
      let _ = worker.send(command);
    }
  }
}

fn list_ports(input: &MidiInput) -> Vec<MidiPort> {
  input
    .ports()
    .iter()
    .filter_map(|port| {
      Some(MidiPort {
        id: port.id(),
        name: input.port_name(port).ok()?,
      })
    })
    .collect()
}

fn open_port(id: String, events: Channel<MidiEvent>) -> Option<MidiInputConnection<()>> {
  let mut input = MidiInput::new(CLIENT_NAME).ok()?;
  // Sysex, clock and active sensing never reach the piano roll, and clock
  // alone would mean dozens of IPC messages a second.
  input.ignore(Ignore::All);
  let port = input.find_port_by_id(id.clone())?;
  input
    .connect(
      &port,
      CLIENT_NAME,
      move |_, data, _| {
        let _ = events.send(MidiEvent::Message {
          port_id: id.clone(),
          data: data.to_vec(),
        });
      },
      (),
    )
    .ok()
}

fn drop_missing_connections<T>(connections: &mut HashMap<String, T>, ports: &[MidiPort]) {
  connections.retain(|id, _| ports.iter().any(|port| &port.id == id));
}

fn run_worker(commands: Receiver<WorkerCommand>, events: Channel<MidiEvent>) {
  let Ok(input) = MidiInput::new(CLIENT_NAME) else {
    return;
  };
  let mut connections = HashMap::new();
  let mut known_ports = None;
  loop {
    let ports = list_ports(&input);
    drop_missing_connections(&mut connections, &ports);
    if known_ports.as_ref() != Some(&ports) {
      let _ = events.send(MidiEvent::Ports { ports: ports.clone() });
      known_ports = Some(ports);
    }
    match commands.recv_timeout(PORT_POLL_INTERVAL) {
      Ok(WorkerCommand::Open(id)) => {
        if let Entry::Vacant(entry) = connections.entry(id) {
          if let Some(connection) = open_port(entry.key().clone(), events.clone()) {
            entry.insert(connection);
          }
        }
      }
      Ok(WorkerCommand::Close(id)) => {
        connections.remove(&id);
      }
      Err(RecvTimeoutError::Timeout) => {}
      Err(RecvTimeoutError::Disconnected) => return,
    }
  }
}

/// Starts reading ports, replacing any earlier listener (a reloaded window).
#[tauri::command]
pub fn midi_start(
  app: AppHandle,
  backend: State<'_, MidiBackend>,
  events: Channel<MidiEvent>,
) -> Result<(), String> {
  let (worker, commands) = mpsc::channel();
  *backend.worker.lock().unwrap() = Some(worker);
  app
    .run_on_main_thread(move || {
      // CoreMIDI only refreshes the port list for a process with a client on
      // a thread running a run loop; without this one, devices plugged in
      // after launch never show up. It lives as long as the app.
      #[cfg(target_os = "macos")]
      {
        use std::sync::Once;
        static RUN_LOOP_CLIENT: Once = Once::new();
        RUN_LOOP_CLIENT.call_once(|| {
          if let Ok(client) = MidiInput::new(CLIENT_NAME) {
            Box::leak(Box::new(client));
          }
        });
      }
      thread::spawn(move || run_worker(commands, events));
    })
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn midi_open(backend: State<'_, MidiBackend>, id: String) {
  backend.send(WorkerCommand::Open(id));
}

#[tauri::command]
pub fn midi_close(backend: State<'_, MidiBackend>, id: String) {
  backend.send(WorkerCommand::Close(id));
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  fn port(id: &str) -> MidiPort {
    MidiPort {
      id: id.to_string(),
      name: format!("{id} name"),
    }
  }

  #[test]
  fn serializes_events_as_the_window_reads_them() {
    assert_eq!(
      serde_json::to_value(MidiEvent::Ports { ports: vec![port("a")] }).unwrap(),
      json!({ "kind": "ports", "ports": [{ "id": "a", "name": "a name" }] })
    );
    assert_eq!(
      serde_json::to_value(MidiEvent::Message {
        port_id: "a".to_string(),
        data: vec![0x90, 60, 100],
      })
      .unwrap(),
      json!({ "kind": "message", "portId": "a", "data": [0x90, 60, 100] })
    );
  }

  #[test]
  fn drops_connections_to_ports_that_are_gone() {
    let mut connections = HashMap::from([("a".to_string(), 1), ("b".to_string(), 2)]);

    drop_missing_connections(&mut connections, &[port("b"), port("c")]);

    assert_eq!(connections, HashMap::from([("b".to_string(), 2)]));
  }
}
