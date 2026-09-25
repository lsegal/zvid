"""Reports Live's record state and set path to ZVID Capture plugin instances.

The protocol is described in `daw/crates/zvid-daw-core/src/live.rs`: plugin
instances send `hello` datagrams to 127.0.0.1:PORT, and this module answers
each with the current status and pushes a status to every instance heard from
in the last SUBSCRIBER_TIMEOUT seconds whenever the status changes.

This module doesn't import Live, so it can be tested outside Live.
"""

import json
import socket
import time

PORT = 47731
PROTOCOL_VERSION = 1
SUBSCRIBER_TIMEOUT = 5.0
# Datagrams read per poll, so a flood can't stall Live's main thread.
MAX_DATAGRAMS_PER_POLL = 64
MAX_DATAGRAM = 8192
# Song properties with reliable LOM listeners. `file_path` and `name` are
# compared on every poll instead, since they change only on save.
OBSERVED = ("record_mode", "session_record", "is_playing")


def open_socket(port=PORT):
    """Binds the non-blocking localhost socket plugin instances talk to."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.bind(("127.0.0.1", port))
        sock.setblocking(False)
    except OSError:
        sock.close()
        raise
    return sock


def _text(value):
    return value if isinstance(value, str) and value else None


class Companion(object):
    """Observes `song` and serves its status on `sock`.

    Call `poll` regularly from Live's main thread (the control surface's
    `update_display`), and `close` when the script is disconnected.
    """

    def __init__(self, song, sock, live_version=None, clock=time.monotonic):
        self._song = song
        self._sock = sock
        self._live_version = live_version
        self._clock = clock
        self._subscribers = {}
        self._sent = None
        for name in OBSERVED:
            getattr(song, "add_%s_listener" % name)(self.publish)

    def status(self):
        song = self._song
        return {
            "v": PROTOCOL_VERSION,
            "type": "status",
            "recordMode": bool(song.record_mode),
            "sessionRecord": bool(song.session_record),
            "isPlaying": bool(song.is_playing),
            # Live 12 exposes the set's path and name; older versions don't.
            "setPath": _text(getattr(song, "file_path", None)),
            "setName": _text(getattr(song, "name", None)),
            "liveVersion": self._live_version,
        }

    def subscribers(self):
        return list(self._subscribers)

    def publish(self):
        """Sends the status to every subscriber if it changed."""
        status = self.status()
        if status == self._sent:
            return
        self._sent = status
        datagram = self._encode(status)
        for address in list(self._subscribers):
            self._send(datagram, address)

    def poll(self):
        """Publishes changes, answers hellos, and forgets silent subscribers.

        Publishing first means a new subscriber gets exactly one status.
        """
        self.publish()
        now = self._clock()
        for _ in range(MAX_DATAGRAMS_PER_POLL):
            try:
                datagram, address = self._sock.recvfrom(MAX_DATAGRAM)
            except BlockingIOError:
                break
            except OSError:
                # Windows reports a send to a closed plugin port as an error
                # on the next receive; skip it and keep reading.
                continue
            if self._is_hello(datagram):
                self._subscribers[address] = now
                self._send(self._encode(self.status()), address)
        for address, heard in list(self._subscribers.items()):
            if now - heard >= SUBSCRIBER_TIMEOUT:
                del self._subscribers[address]

    def close(self):
        for name in OBSERVED:
            remove = getattr(self._song, "remove_%s_listener" % name)
            has = getattr(self._song, "%s_has_listener" % name)
            if has(self.publish):
                remove(self.publish)
        self._subscribers.clear()
        self._sock.close()

    @staticmethod
    def _is_hello(datagram):
        try:
            message = json.loads(datagram.decode("utf-8"))
        except ValueError:
            return False
        return (
            isinstance(message, dict)
            and message.get("v") == PROTOCOL_VERSION
            and message.get("type") == "hello"
        )

    @staticmethod
    def _encode(status):
        return json.dumps(status, separators=(",", ":")).encode("utf-8")

    def _send(self, datagram, address):
        try:
            self._sock.sendto(datagram, address)
        except OSError:
            # A full buffer or a vanished plugin; the next status or hello
            # recovers.
            pass
