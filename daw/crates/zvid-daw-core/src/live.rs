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
use std::sync::{Arc, Mutex, MutexGuard};
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

/// What [`LiveArming`] asks of the capture.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ArmRequest {
    /// Start a capture, as the Record button does.
    Arm,
    /// End it, as the Stop capturing button does.
    Disarm,
}

/// Follows Live's record buttons with the capture, in place of the plugin's
/// Record button. Pure: the control thread feeds it the companion's status
/// and carries out its requests.
///
/// - Either record button turning on asks to arm until an arm is
///   [done](LiveArming::done); both turning off asks to disarm a capture
///   that Live armed.
/// - When the companion goes away, the capture it armed keeps running until
///   the user stops it, so no footage is dropped. A companion that comes
///   back takes over again from its next status.
/// - Without a companion it asks for nothing, and the Record button works
///   as before.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct LiveArming {
    /// Whether Live's record buttons want a capture, while the companion is
    /// present.
    wanted: Option<bool>,
    /// Whether the running capture is one Live armed.
    armed: bool,
}

impl LiveArming {
    /// Takes the companion's latest status, or `None` once it is absent.
    pub fn update(&mut self, status: Option<&LiveStatus>) {
        match status {
            Some(status) => self.wanted = Some(status.record_armed()),
            None => *self = Self::default(),
        }
    }

    /// What Live's record buttons still ask for.
    pub fn pending(&self) -> Option<ArmRequest> {
        match (self.wanted?, self.armed) {
            (true, false) => Some(ArmRequest::Arm),
            (false, true) => Some(ArmRequest::Disarm),
            _ => None,
        }
    }

    /// Records that `request` was carried out.
    pub fn done(&mut self, request: ArmRequest) {
        self.armed = request == ArmRequest::Arm;
    }
}

/// The latest [`LiveStatus`] of one plugin instance, shared between the
/// control thread that polls its [`LiveLink`] and the editor backend, which
/// shows Live's record state and reads the set directory when capture
/// arms. Clones share the status.
#[derive(Clone, Debug, Default)]
pub struct SharedLiveStatus {
    status: Arc<Mutex<Option<LiveStatus>>>,
}

impl SharedLiveStatus {
    /// Replaces the status; `None` while the companion is absent.
    pub fn set(&self, status: Option<LiveStatus>) {
        *self.lock() = status;
    }

    pub fn get(&self) -> Option<LiveStatus> {
        self.lock().clone()
    }

    /// The open set's directory, or `None` while the set is unsaved, the
    /// Live version doesn't report it, or the companion is absent.
    pub fn set_dir(&self) -> Option<PathBuf> {
        self.lock().as_ref().and_then(LiveStatus::set_dir)
    }

    fn lock(&self) -> MutexGuard<'_, Option<LiveStatus>> {
        self.status
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
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
    fn shares_the_latest_status() {
        let shared = SharedLiveStatus::default();
        let reader = shared.clone();
        assert_eq!(reader.get(), None);
        assert_eq!(reader.set_dir(), None);
        shared.set(LiveStatus::parse(STATUS.as_bytes()));
        assert_eq!(reader.set_dir(), Some(PathBuf::from("/music/Song Project")));
        shared.set(None);
        assert_eq!(reader.get(), None);
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

    /// A status with Live's record buttons as given.
    fn recording(record_mode: bool, session_record: bool) -> LiveStatus {
        LiveStatus {
            record_mode,
            session_record,
            ..LiveStatus::default()
        }
    }

    /// Feeds `status` and carries out whatever is pending.
    fn follow(arming: &mut LiveArming, status: Option<&LiveStatus>) -> Option<ArmRequest> {
        arming.update(status);
        let request = arming.pending();
        if let Some(request) = request {
            arming.done(request);
        }
        request
    }

    #[test]
    fn record_buttons_arm_and_disarm() {
        let mut arming = LiveArming::default();
        assert_eq!(arming.pending(), None);
        let off = recording(false, false);
        assert_eq!(follow(&mut arming, Some(&off)), None);
        assert_eq!(
            follow(&mut arming, Some(&recording(true, false))),
            Some(ArmRequest::Arm)
        );
        // Play/stop and the other button changing are no edge.
        let playing = LiveStatus {
            is_playing: true,
            ..recording(true, true)
        };
        assert_eq!(follow(&mut arming, Some(&playing)), None);
        assert_eq!(follow(&mut arming, Some(&recording(false, true))), None);
        assert_eq!(follow(&mut arming, Some(&off)), Some(ArmRequest::Disarm));
        assert_eq!(follow(&mut arming, Some(&off)), None);
        assert_eq!(
            follow(&mut arming, Some(&recording(false, true))),
            Some(ArmRequest::Arm)
        );
    }

    #[test]
    fn an_arm_is_asked_for_until_done() {
        let mut arming = LiveArming::default();
        arming.update(Some(&recording(true, false)));
        assert_eq!(arming.pending(), Some(ArmRequest::Arm));
        // Not done, e.g. no camera yet: still pending on the next status.
        arming.update(Some(&recording(true, false)));
        assert_eq!(arming.pending(), Some(ArmRequest::Arm));
        // Released before it was done: nothing to disarm.
        arming.update(Some(&recording(false, false)));
        assert_eq!(arming.pending(), None);
    }

    #[test]
    fn a_vanished_companion_leaves_the_capture_running() {
        let mut arming = LiveArming::default();
        follow(&mut arming, Some(&recording(true, false)));
        assert_eq!(follow(&mut arming, None), None);
        assert_eq!(arming, LiveArming::default());
        // Back with record off: the capture is the user's to stop now.
        assert_eq!(follow(&mut arming, Some(&recording(false, false))), None);
        // Back with record on: Live takes over again.
        assert_eq!(
            follow(&mut arming, Some(&recording(true, false))),
            Some(ArmRequest::Arm)
        );
        assert_eq!(
            follow(&mut arming, Some(&recording(false, false))),
            Some(ArmRequest::Disarm)
        );
    }

    #[test]
    fn nothing_is_asked_without_a_companion() {
        let mut arming = LiveArming::default();
        for _ in 0..3 {
            assert_eq!(follow(&mut arming, None), None);
        }
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
