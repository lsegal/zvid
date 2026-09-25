//! Protocol and client for the optional Live companion: a MIDI Remote Script
//! (`daw/live-remote-script/ZVID_Capture`) that reads Live's record state and
//! the open set's path from the Live Object Model and reports them over
//! localhost UDP. VST3 and AU expose neither reliably (#200).
//!
//! The script listens on `127.0.0.1:`[`COMPANION_PORT`]. Each plugin instance
//! binds its own ephemeral localhost port and sends a `hello` datagram every
//! [`HELLO_INTERVAL`]. The script answers each hello with the current status,
//! and pushes a status to every instance it heard from recently whenever the
//! status changes. An instance that hears nothing for [`LINK_TIMEOUT`] treats
//! the companion as absent.
//!
//! Datagrams are UTF-8 JSON objects with a protocol version `v` and a `type`:
//!
//! ```jsonc
//! {"v": 1, "type": "hello"}                        // plugin → script
//! {"v": 1, "type": "status", "recordMode": true,   // script → plugin
//!  "sessionRecord": false, "isPlaying": true,
//!  "setPath": "/music/Song Project/Song.als",     // null while unsaved
//!  "setName": "Song", "liveVersion": "12.0.25"}
//! ```

use std::fmt;
use std::io::{self, ErrorKind};
use std::net::{Ipv4Addr, SocketAddr, UdpSocket};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::Deserialize;

/// Localhost UDP port the companion script listens on.
pub const COMPANION_PORT: u16 = 47_731;
/// Protocol version both sides send as `v`.
pub const PROTOCOL_VERSION: u64 = 1;
/// How often a plugin instance says hello. The script forgets instances it
/// hasn't heard from in 5 s.
pub const HELLO_INTERVAL: Duration = Duration::from_secs(1);
/// Silence after which the companion counts as absent.
pub const LINK_TIMEOUT: Duration = Duration::from_secs(3);
/// Datagrams read per [`LiveLink::poll`], so a flood can't stall the caller.
const MAX_DATAGRAMS_PER_POLL: usize = 64;
/// Largest datagram read; statuses are a few hundred bytes.
const MAX_DATAGRAM: usize = 8 << 10;

/// What the companion reports about Live.
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveStatus {
    /// `Song.record_mode`: the Arrangement Record button.
    pub record_mode: bool,
    /// `Song.session_record`: the Session Record button.
    pub session_record: bool,
    /// `Song.is_playing`.
    pub is_playing: bool,
    /// `Song.file_path`: the open `.als`, or `None` while the set is unsaved
    /// or the Live version doesn't expose it.
    #[serde(default)]
    pub set_path: Option<String>,
    /// `Song.name`.
    #[serde(default)]
    pub set_name: Option<String>,
    #[serde(default)]
    pub live_version: Option<String>,
}

impl LiveStatus {
    /// Decodes a status datagram. Returns `None` for hellos, other protocol
    /// versions and malformed input.
    pub fn parse(datagram: &[u8]) -> Option<Self> {
        let value: serde_json::Value = serde_json::from_slice(datagram).ok()?;
        if value.get("v")?.as_u64()? != PROTOCOL_VERSION || value.get("type")?.as_str()? != "status"
        {
            return None;
        }
        serde_json::from_value(value).ok()
    }

    /// Whether either of Live's record buttons is on. This replaces the
    /// plugin's own Record button: capture is armed while it holds, and takes
    /// still follow play/stop.
    pub fn record_armed(&self) -> bool {
        self.record_mode || self.session_record
    }

    /// Directory of the open set, for [`crate::RecordRoot::resolve`].
    pub fn set_dir(&self) -> Option<PathBuf> {
        let path = Path::new(self.set_path.as_deref().filter(|path| !path.is_empty())?);
        path.parent()
            .filter(|dir| !dir.as_os_str().is_empty())
            .map(Path::to_path_buf)
    }
}

impl fmt::Display for LiveStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let on = |flag: bool| if flag { "on" } else { "off" };
        write!(
            f,
            "record={} session-record={} playing={} set={}",
            on(self.record_mode),
            on(self.session_record),
            on(self.is_playing),
            self.set_path.as_deref().unwrap_or("(unsaved)"),
        )?;
        if let Some(version) = &self.live_version {
            write!(f, " live={version}")?;
        }
        Ok(())
    }
}

/// The `hello` datagram a plugin instance sends.
pub fn hello_datagram() -> Vec<u8> {
    format!(r#"{{"v":{PROTOCOL_VERSION},"type":"hello"}}"#).into_bytes()
}

/// A plugin instance's end of the companion link. Non-blocking: call
/// [`LiveLink::poll`] regularly from the control thread, never from the
/// audio thread.
pub struct LiveLink {
    socket: UdpSocket,
    companion: SocketAddr,
    last_hello: Option<Instant>,
    last_heard: Option<Instant>,
    status: Option<LiveStatus>,
    buffer: Vec<u8>,
}

impl LiveLink {
    /// Binds an ephemeral localhost port that talks to the companion on
    /// [`COMPANION_PORT`].
    pub fn connect() -> io::Result<Self> {
        Self::connect_to(SocketAddr::from((Ipv4Addr::LOCALHOST, COMPANION_PORT)))
    }

    /// [`LiveLink::connect`] with an explicit companion address.
    pub fn connect_to(companion: SocketAddr) -> io::Result<Self> {
        let socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))?;
        socket.set_nonblocking(true)?;
        Ok(Self {
            socket,
            companion,
            last_hello: None,
            last_heard: None,
            status: None,
            buffer: vec![0; MAX_DATAGRAM],
        })
    }

    /// The latest status, or `None` while the companion is absent.
    pub fn status(&self) -> Option<&LiveStatus> {
        self.status.as_ref()
    }

    /// Says hello when due, reads queued statuses, and expires a silent
    /// companion. Returns whether [`LiveLink::status`] changed.
    pub fn poll(&mut self, now: Instant) -> bool {
        if self
            .last_hello
            .is_none_or(|last| now.saturating_duration_since(last) >= HELLO_INTERVAL)
        {
            // Nobody listening is the normal case outside Live.
            let _ = self.socket.send_to(&hello_datagram(), self.companion);
            self.last_hello = Some(now);
        }
        let mut latest = None;
        for _ in 0..MAX_DATAGRAMS_PER_POLL {
            match self.socket.recv_from(&mut self.buffer) {
                Ok((len, from)) if from == self.companion => {
                    if let Some(status) = LiveStatus::parse(&self.buffer[..len]) {
                        latest = Some(status);
                    }
                }
                Ok(_) => {}
                Err(error) if error.kind() == ErrorKind::WouldBlock => break,
                // Windows reports an earlier hello to a closed port as a
                // reset on the next receive; skip it and keep reading.
                Err(_) => {}
            }
        }
        if let Some(status) = latest {
            self.last_heard = Some(now);
            let changed = self.status.as_ref() != Some(&status);
            self.status = Some(status);
            return changed;
        }
        let silent = self
            .last_heard
            .is_none_or(|heard| now.saturating_duration_since(heard) >= LINK_TIMEOUT);
        silent && self.status.take().is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const STATUS: &str = r#"{"v":1,"type":"status","recordMode":true,"sessionRecord":false,
        "isPlaying":true,"setPath":"/music/Song Project/Song.als","setName":"Song",
        "liveVersion":"12.0.25","future":1}"#;

    #[test]
    fn parses_a_status() {
        let status = LiveStatus::parse(STATUS.as_bytes()).unwrap();
        assert!(status.record_mode && !status.session_record && status.is_playing);
        assert_eq!(status.set_name.as_deref(), Some("Song"));
        assert_eq!(status.live_version.as_deref(), Some("12.0.25"));
        assert_eq!(status.set_dir(), Some(PathBuf::from("/music/Song Project")));
        assert!(status.record_armed());
    }

    #[test]
    fn rejects_other_messages() {
        assert_eq!(LiveStatus::parse(&hello_datagram()), None);
        assert_eq!(
            LiveStatus::parse(STATUS.replace(r#""v":1"#, r#""v":2"#).as_bytes()),
            None
        );
        assert_eq!(LiveStatus::parse(br#"{"v":1,"type":"status"}"#), None);
        assert_eq!(LiveStatus::parse(b"not json"), None);
    }

    #[test]
    fn unsaved_sets_have_no_directory() {
        let status = |set_path: Option<&str>| LiveStatus {
            set_path: set_path.map(str::to_string),
            ..LiveStatus::default()
        };
        assert_eq!(status(None).set_dir(), None);
        assert_eq!(status(Some("")).set_dir(), None);
        assert_eq!(status(Some("Song.als")).set_dir(), None);
    }

    #[test]
    fn either_record_button_arms_capture() {
        let status = |record_mode, session_record| LiveStatus {
            record_mode,
            session_record,
            ..LiveStatus::default()
        };
        assert!(!status(false, false).record_armed());
        assert!(status(true, false).record_armed());
        assert!(status(false, true).record_armed());
    }

    #[test]
    fn describes_the_status() {
        let status = LiveStatus::parse(STATUS.as_bytes()).unwrap();
        assert_eq!(
            status.to_string(),
            "record=on session-record=off playing=on set=/music/Song Project/Song.als live=12.0.25"
        );
    }

    /// Reads datagrams on `socket` until one arrives or a second passes.
    fn receive(socket: &UdpSocket) -> (Vec<u8>, SocketAddr) {
        socket
            .set_read_timeout(Some(Duration::from_secs(1)))
            .unwrap();
        let mut buffer = [0; 1024];
        let (len, from) = socket.recv_from(&mut buffer).expect("a datagram");
        (buffer[..len].to_vec(), from)
    }

    /// Polls until the link reports a change or a second passes.
    fn poll_until_changed(link: &mut LiveLink, now: Instant) -> bool {
        let deadline = Instant::now() + Duration::from_secs(1);
        while Instant::now() < deadline {
            if link.poll(now) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        false
    }

    #[test]
    fn talks_to_a_companion_over_localhost() {
        let companion = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let mut link = LiveLink::connect_to(companion.local_addr().unwrap()).unwrap();
        let start = Instant::now();

        assert!(!link.poll(start));
        let (hello, plugin) = receive(&companion);
        assert_eq!(hello, hello_datagram());

        // A stranger's datagrams are ignored.
        let stranger = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        stranger.send_to(STATUS.as_bytes(), plugin).unwrap();
        companion.send_to(STATUS.as_bytes(), plugin).unwrap();
        assert!(poll_until_changed(&mut link, start));
        assert_eq!(link.status(), LiveStatus::parse(STATUS.as_bytes()).as_ref());

        // The same status again is not a change, and no hello is due yet.
        companion.send_to(STATUS.as_bytes(), plugin).unwrap();
        for _ in 0..20 {
            assert!(!link.poll(start + Duration::from_millis(500)));
            std::thread::sleep(Duration::from_millis(5));
        }
        companion
            .set_read_timeout(Some(Duration::from_millis(100)))
            .unwrap();
        assert!(companion.recv_from(&mut [0; 64]).is_err());

        // The next hello goes out once the interval passes.
        assert!(!link.poll(start + HELLO_INTERVAL));
        assert_eq!(receive(&companion).0, hello_datagram());

        // Silence since the last status (read at 500 ms) drops it.
        let heard = start + Duration::from_millis(500);
        assert!(!link.poll(heard + LINK_TIMEOUT - Duration::from_millis(1)));
        assert!(link.poll(heard + LINK_TIMEOUT));
        assert_eq!(link.status(), None);
        assert!(!link.poll(heard + LINK_TIMEOUT * 2));
    }

    #[test]
    fn stays_quiet_without_a_companion() {
        // Bind and drop a socket so the port is very likely closed.
        let closed = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))
            .unwrap()
            .local_addr()
            .unwrap();
        let mut link = LiveLink::connect_to(closed).unwrap();
        let start = Instant::now();
        for step in 0..5 {
            assert!(!link.poll(start + HELLO_INTERVAL * step));
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(link.status(), None);
    }
}
