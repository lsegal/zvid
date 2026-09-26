//! The format layers' control-thread side of the optional Live companion:
//! Live's record buttons arm and disarm the instance's capture through its
//! [`Backend`], as the Record and Stop capturing buttons do. Takes still
//! follow play/stop from the plugin transport; the companion only replaces
//! the arm signal.

use std::io;
use std::sync::Arc;
use std::time::{Duration, Instant};

use zvid_daw_core::{ArmRequest, LiveArming, LiveLink};

use crate::backend::Backend;

/// How long to wait before asking again after an arm failed while Live's
/// record button stays on: the camera may still be opening, or none is
/// chosen yet.
pub const ARM_RETRY: Duration = Duration::from_secs(1);

/// A plugin instance's link to the Live companion, driving its capture.
pub struct LiveControl {
    link: LiveLink,
    arming: LiveArming,
    /// Set after a failed request: when to try again.
    retry_at: Option<Instant>,
}

impl LiveControl {
    /// Links to the companion on its usual port.
    pub fn connect() -> io::Result<Self> {
        LiveLink::connect().map(Self::new)
    }

    pub fn new(link: LiveLink) -> Self {
        Self {
            link,
            arming: LiveArming::default(),
            retry_at: None,
        }
    }

    /// Polls the link, logs what the companion reports, and carries out what
    /// Live's record buttons ask of the capture. Call it from the control
    /// thread, never the audio thread.
    ///
    /// `backend` returns the instance's backend, starting it on first use.
    /// It is called as soon as the companion is present, so the camera is
    /// already previewing and arming only has to start the encoder.
    pub fn poll(
        &mut self,
        now: Instant,
        backend: impl FnOnce() -> Arc<dyn Backend>,
        mut log: impl FnMut(&str),
    ) {
        if self.link.poll(now) {
            let status = self.link.status();
            match status {
                Some(status) => log(&format!("live companion: {status}")),
                None => log("live companion: gone; the capture is left to the Record button"),
            }
            self.arming.update(status);
            self.retry_at = None;
        }
        if self.link.status().is_none() {
            return;
        }
        let backend = backend();
        let Some(request) = self.arming.pending() else {
            return;
        };
        if self.retry_at.is_some_and(|at| now < at) {
            return;
        }
        let result = match request {
            ArmRequest::Arm => backend.arm(),
            ArmRequest::Disarm => backend.disarm(),
        };
        match result {
            Ok(()) => {
                log(match request {
                    ArmRequest::Arm => "live companion: armed capture",
                    ArmRequest::Disarm => "live companion: disarmed capture",
                });
                self.arming.done(request);
                self.retry_at = None;
            }
            Err(error) => {
                if self.retry_at.is_none() {
                    log(&format!(
                        "live companion: could not arm capture: {}",
                        error.message
                    ));
                }
                self.retry_at = Some(now + ARM_RETRY);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::net::{Ipv4Addr, SocketAddr, UdpSocket};

    use zvid_daw_core::{RecordRoot, State};

    use super::*;
    use crate::mock::MockBackend;

    /// A stand-in companion script on an ephemeral localhost port.
    struct Companion {
        socket: UdpSocket,
        plugin: Option<SocketAddr>,
    }

    impl Companion {
        fn new() -> Self {
            let socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
            socket.set_nonblocking(true).unwrap();
            Self {
                socket,
                plugin: None,
            }
        }

        /// Remembers who said hello.
        fn listen(&mut self) {
            let mut buffer = [0; 256];
            while let Ok((_, from)) = self.socket.recv_from(&mut buffer) {
                self.plugin = Some(from);
            }
        }

        fn send(&mut self, record_mode: bool, session_record: bool) {
            self.listen();
            let status = format!(
                r#"{{"v":1,"type":"status","recordMode":{record_mode},
                    "sessionRecord":{session_record},"isPlaying":false}}"#
            );
            self.socket
                .send_to(status.as_bytes(), self.plugin.expect("a hello"))
                .unwrap();
        }
    }

    struct Rig {
        companion: Companion,
        control: LiveControl,
        backend: Arc<MockBackend>,
        started: bool,
        log: Vec<String>,
    }

    impl Rig {
        fn new(camera: Option<&str>) -> Self {
            let companion = Companion::new();
            let link = LiveLink::connect_to(companion.socket.local_addr().unwrap()).unwrap();
            let backend = Arc::new(MockBackend::new(
                RecordRoot::resolve_or_temp(None),
                State::default(),
                None,
            ));
            if let Some(camera) = camera {
                backend.select_camera(camera).unwrap();
            }
            let mut rig = Self {
                companion,
                control: LiveControl::new(link),
                backend,
                started: false,
                log: Vec::new(),
            };
            // Say hello, so the companion knows where to send statuses.
            rig.poll(Instant::now());
            std::thread::sleep(Duration::from_millis(20));
            rig
        }

        fn poll(&mut self, now: Instant) {
            let backend: Arc<dyn Backend> = self.backend.clone();
            let started = &mut self.started;
            let log = &mut self.log;
            self.control.poll(
                now,
                || {
                    *started = true;
                    backend
                },
                |line| log.push(line.to_string()),
            );
        }

        /// Sends a status and polls until it has been read.
        fn status(&mut self, now: Instant, record_mode: bool, session_record: bool) {
            self.companion.send(record_mode, session_record);
            let deadline = Instant::now() + Duration::from_secs(1);
            let logged = self.log.len();
            while self.log.len() == logged && Instant::now() < deadline {
                self.poll(now);
                std::thread::sleep(Duration::from_millis(5));
            }
            assert!(self.log.len() > logged, "the status arrived");
        }
    }

    #[test]
    fn record_buttons_drive_the_capture() {
        let mut rig = Rig::new(Some("mock-builtin"));
        let now = Instant::now();
        assert!(!rig.started, "no backend without a companion");

        rig.status(now, false, false);
        assert!(rig.started, "the companion warms the backend");
        assert!(!rig.backend.is_armed());

        rig.status(now, true, false);
        assert!(rig.backend.is_armed());
        rig.backend.set_playing(true);
        rig.backend.set_playing(false);
        rig.status(now, true, true);
        assert!(rig.backend.is_armed());
        rig.status(now, false, false);
        assert!(!rig.backend.is_armed());

        rig.status(now, false, true);
        assert!(rig.backend.is_armed());
        rig.status(now, false, false);
        assert!(!rig.backend.is_armed());
    }

    #[test]
    fn a_vanished_companion_keeps_capturing() {
        let mut rig = Rig::new(Some("mock-builtin"));
        let now = Instant::now();
        rig.status(now, true, false);
        assert!(rig.backend.is_armed());

        rig.poll(now + zvid_daw_core::live::LINK_TIMEOUT);
        assert!(rig.log.last().unwrap().contains("gone"));
        assert!(rig.backend.is_armed(), "footage is never dropped");

        // Back with record off: the user stops the capture, not Live.
        let later = now + zvid_daw_core::live::LINK_TIMEOUT * 2;
        rig.status(later, false, false);
        assert!(rig.backend.is_armed());
        rig.backend.disarm().unwrap();
        assert!(!rig.backend.is_armed());
    }

    #[test]
    fn leaves_a_capture_armed_by_hand() {
        let mut rig = Rig::new(Some("mock-builtin"));
        let now = Instant::now();
        rig.backend.arm().unwrap();
        rig.status(now, false, false);
        rig.poll(now);
        assert!(rig.backend.is_armed());
    }

    #[test]
    fn retries_a_failed_arm() {
        let mut rig = Rig::new(None);
        let now = Instant::now();
        rig.status(now, true, false);
        assert!(!rig.backend.is_armed());
        let failures = |rig: &Rig| {
            rig.log
                .iter()
                .filter(|line| line.contains("could not arm"))
                .count()
        };
        assert_eq!(failures(&rig), 1);

        // A camera is chosen; the arm waits for the retry.
        rig.backend.select_camera("mock-builtin").unwrap();
        rig.poll(now + ARM_RETRY / 2);
        assert!(!rig.backend.is_armed());
        rig.poll(now + ARM_RETRY);
        assert!(rig.backend.is_armed());
        assert_eq!(failures(&rig), 1, "a failure is logged once");
    }
}
