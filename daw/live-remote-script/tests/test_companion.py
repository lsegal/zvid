"""Tests the companion against a fake Live song over real localhost sockets.

Run from `daw/live-remote-script`: `python -m unittest discover tests`.
"""

import json
import os
import socket
import sys
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "ZVID_Capture"))

import companion  # noqa: E402
from companion import Companion, open_socket  # noqa: E402


class FakeSong(object):
    """The part of `Live.Song.Song` the companion uses."""

    def __init__(self):
        self.record_mode = False
        self.session_record = False
        self.is_playing = False
        self.file_path = ""
        self.name = ""
        self.listeners = {name: [] for name in companion.OBSERVED}
        for name in companion.OBSERVED:
            setattr(self, "add_%s_listener" % name, self.listeners[name].append)
            setattr(self, "remove_%s_listener" % name, self.listeners[name].remove)
            setattr(self, "%s_has_listener" % name, self._has(name))

    def _has(self, name):
        return lambda listener: listener in self.listeners[name]

    def set(self, name, value):
        setattr(self, name, value)
        for listener in list(self.listeners.get(name, ())):
            listener()


class Clock(object):
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now


def plugin_socket():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", 0))
    sock.settimeout(1.0)
    return sock


def receive(sock):
    datagram, _ = sock.recvfrom(companion.MAX_DATAGRAM)
    return json.loads(datagram.decode("utf-8"))


def assert_silent(test, sock):
    sock.settimeout(0.1)
    try:
        with test.assertRaises(socket.timeout):
            sock.recvfrom(companion.MAX_DATAGRAM)
    finally:
        sock.settimeout(1.0)


class CompanionTest(unittest.TestCase):
    def setUp(self):
        self.song = FakeSong()
        self.clock = Clock()
        self.server = open_socket(port=0)
        self.address = self.server.getsockname()
        self.companion = Companion(self.song, self.server, "12.0.25", clock=self.clock)
        self.plugin = plugin_socket()
        self.addCleanup(self.plugin.close)

    def hello(self, sock=None):
        sock = sock or self.plugin
        sock.sendto(b'{"v":1,"type":"hello"}', self.address)
        deadline = time.monotonic() + 1.0
        while sock.getsockname() not in self.companion.subscribers():
            self.assertLess(time.monotonic(), deadline, "the hello never arrived")
            self.companion.poll()
            time.sleep(0.005)

    def tearDown(self):
        if self.song.listeners["record_mode"]:
            self.companion.close()

    def test_answers_a_hello_with_the_status(self):
        self.hello()
        self.assertEqual(
            receive(self.plugin),
            {
                "v": 1,
                "type": "status",
                "recordMode": False,
                "sessionRecord": False,
                "isPlaying": False,
                "setPath": None,
                "setName": None,
                "liveVersion": "12.0.25",
            },
        )

    def test_pushes_record_and_transport_changes(self):
        self.hello()
        receive(self.plugin)
        self.song.set("record_mode", True)
        self.assertTrue(receive(self.plugin)["recordMode"])
        self.song.set("is_playing", True)
        self.assertTrue(receive(self.plugin)["isPlaying"])
        self.song.set("session_record", True)
        self.assertTrue(receive(self.plugin)["sessionRecord"])
        # A listener firing without a change sends nothing.
        self.song.set("is_playing", True)
        assert_silent(self, self.plugin)

    def test_notices_the_set_path_on_poll(self):
        self.hello()
        receive(self.plugin)
        self.song.file_path = "/music/Song Project/Song.als"
        self.song.name = "Song"
        self.companion.poll()
        status = receive(self.plugin)
        self.assertEqual(status["setPath"], "/music/Song Project/Song.als")
        self.assertEqual(status["setName"], "Song")

    def test_handles_live_versions_without_a_set_path(self):
        del self.song.file_path
        del self.song.name
        self.hello()
        status = receive(self.plugin)
        self.assertIsNone(status["setPath"])
        self.assertIsNone(status["setName"])

    def test_serves_several_instances_and_forgets_silent_ones(self):
        other = plugin_socket()
        self.addCleanup(other.close)
        self.hello()
        self.hello(other)
        receive(self.plugin)
        receive(other)
        self.song.set("record_mode", True)
        self.assertTrue(receive(self.plugin)["recordMode"])
        self.assertTrue(receive(other)["recordMode"])

        self.clock.now += companion.SUBSCRIBER_TIMEOUT
        self.companion.poll()
        self.assertEqual(self.companion.subscribers(), [])
        self.song.set("record_mode", False)
        assert_silent(self, self.plugin)

    def test_ignores_other_datagrams(self):
        for datagram in (b"nonsense", b'{"v":2,"type":"hello"}', b'{"v":1,"type":"status"}', b"[]"):
            self.plugin.sendto(datagram, self.address)
        time.sleep(0.05)
        self.companion.poll()
        self.assertEqual(self.companion.subscribers(), [])
        assert_silent(self, self.plugin)

    def test_close_removes_listeners_and_the_socket(self):
        self.companion.close()
        for listeners in self.song.listeners.values():
            self.assertEqual(listeners, [])
        self.assertEqual(self.server.fileno(), -1)


if __name__ == "__main__":
    unittest.main()
