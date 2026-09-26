# ZVID Capture companion for Ableton Live

An optional Live MIDI Remote Script that tells ZVID Capture plugin instances
what VST3 and AU don't report reliably:

- **Record state:** `Song.record_mode` (Arrangement Record) and
  `Song.session_record` (Session Record), plus `Song.is_playing`, observed
  with Live Object Model listeners.
- **Set path:** `Song.file_path` and `Song.name`, so captures can go to
  `<set dir>/Recorded/ZVID`. These properties exist in Live 11.3.42 and
  12.0.25 but not in 11.3.10; the script sends `null` where they're missing.

It is Python because Live only runs Remote Scripts written in Python. It is a
companion, not part of the plugin binary: the plugin works without it and
falls back to its own Record button and `<Documents>/ZVID/Recorded`. See
[`../ARCHITECTURE.md`](../ARCHITECTURE.md#live-integration-record-state-and-set-directory)
for why, and `crates/zvid-daw-core/src/live.rs` for the protocol.

## Install

1. Copy the `ZVID_Capture` folder into the `Remote Scripts` folder of your
   Live User Library, replacing any older copy. From a checkout, run this in
   `daw`:

   ```sh
   cargo xtask install-live-script
   ```

   It installs into Live's default User Library:
   - macOS: `~/Music/Ableton/User Library/Remote Scripts/ZVID_Capture`
   - Windows: `%USERPROFILE%\Documents\Ableton\User Library\Remote Scripts\ZVID_Capture`

   If you moved the User Library (*Settings › Library › Location of User
   Library* in Live), pass it with `--user-library <path>`. Without a
   checkout, copy `live-remote-script/ZVID_Capture` from a ZVID Capture
   bundle (`cargo xtask bundle` writes it to
   `target/bundle/live-remote-script/ZVID_Capture`) into the same place by
   hand.
2. Restart Live.
3. In *Settings › Link, Tempo & MIDI*, pick **ZVID Capture** in an empty
   Control Surface slot. Leave its Input and Output set to *None*.

Live loads the script with every set from then on. It listens on
`127.0.0.1:47731` (UDP, localhost only) and logs
`ZVID Capture: listening on 127.0.0.1:47731` to Live's `Log.txt`.

## Test

The tests run the companion against a fake song over real localhost
sockets, so they need no Live:

```sh
cd daw/live-remote-script
python -m unittest discover tests
```

To see it working with the plugin, run Live with `ZVID_DAW_LOG` set to a
file path. The VST3 plugin logs a `live companion: …` line each time the
record buttons, transport or set path change.
