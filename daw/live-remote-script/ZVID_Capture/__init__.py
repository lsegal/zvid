"""ZVID Capture companion for Ableton Live.

Reports Live's record buttons, transport state and the open set's path to
ZVID Capture plugin instances over localhost UDP, since VST3 and AU don't
report them reliably. See `daw/live-remote-script/README.md`.
"""

from _Framework.ControlSurface import ControlSurface

from .companion import PORT, Companion, open_socket


def create_instance(c_instance):
    return ZvidCapture(c_instance)


class ZvidCapture(ControlSurface):
    def __init__(self, c_instance):
        ControlSurface.__init__(self, c_instance)
        self._companion = None
        try:
            sock = open_socket()
        except OSError as error:
            self.log_message("ZVID Capture: cannot listen on port %d: %s" % (PORT, error))
            return
        self._companion = Companion(
            self.song(), sock, live_version=self.application().get_version_string()
        )
        self.log_message("ZVID Capture: listening on 127.0.0.1:%d" % PORT)

    def update_display(self):
        ControlSurface.update_display(self)
        if self._companion is not None:
            self._companion.poll()

    def disconnect(self):
        if self._companion is not None:
            self._companion.close()
            self._companion = None
        ControlSurface.disconnect(self)
