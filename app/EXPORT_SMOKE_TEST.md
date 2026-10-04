# MP4 export smoke test

Use this when changing the zvidlib export bridge or either harness. It runs the
real `exportVideo` path with 48 changing canvas frames over two seconds. The
audible case supplies a 48 kHz, 440 Hz tone as main audio. The source is
generated in the browser, so the test needs no media file import.

## Browser

From the repository root, install app dependencies with the pnpm version that
reads `app/pnpm-lock.yaml`, then build the WebAssembly bridge and start Vite:

```powershell
cd app
npx -y pnpm@8 install --frozen-lockfile
npx -y pnpm@8 run build
npx -y pnpm@8 dev
```

Open `http://localhost:1420/export-smoke.html` in a browser with a HEVC, AV1
or H.264 video encoder and an AAC audio encoder. Click **Export video only**
and **Export with audio**. Each button reports `Saved ...` on success; keep the
two downloaded MP4 files. If the runtime lacks HEVC/AV1/H.264 or AAC, record
the exact error and browser version. An unsupported encoder is a platform
result, not a passing export.

The page exports with the default Session Settings (Auto codec, High quality,
AAC 192 kbps at 48 kHz) and reports the effective settings, like
`320×180 · 24 fps · AV1 · 0.5 Mbps`. Query parameters override the encoding:
`codec` (`auto`, `h264`, `hevc` or `av1`), `mbps` (a custom video bitrate),
`audioKbps` (128, 192, 256 or 320) and `sampleRate` (44100 or 48000), for
example `export-smoke.html?codec=h264&mbps=2&sampleRate=44100`. A codec the
runtime can't encode fails before rendering and suggests Auto.

## Tauri

The native app uses the same page during development. Keep the Vite server
running, and create `app/smoke-tauri.json` with:

```json
{"build":{"beforeDevCommand":"","devUrl":"http://127.0.0.1:1420/export-smoke.html"}}
```

Then run this in another shell from `app`:

```powershell
npx -y pnpm@8 exec tauri dev --config smoke-tauri.json --no-watch
```

Click the same two export buttons and save both files. On macOS, first export
video only, then click **Test native AAC fallback** and save the resulting
`smoke-native-aac.mp4`. This calls the Tauri AAC command with PCM directly, so
it exercises AudioToolbox even when the WebView also supports browser AAC. On
Windows or another platform without that native encoder, the button should
report `Native AAC export currently requires macOS AudioToolbox.`; the normal
audible export can still succeed through WebCodecs AAC.

The temporary Tauri config is only for this test. Remove it afterwards.

`pnpm --dir app run test:web` runs the browser video-only export in headless
Chromium and checks that the saved MP4 carries a JPEG thumbnail of the frame
one second in. CI runs it, with the rest of the app browser tests, on pushes
to `main`.

The `macOS AAC fallback` GitHub Actions workflow also runs this smoke page in
Tauri on a macOS runner. It selects the video-only and native AAC paths, saves
both MP4s without a dialog, and runs the media validator. The automation uses
the `automationOutputDir` query parameter in the temporary Tauri `devUrl`; the
normal page still uses native save dialogs.

## Inspect and play the saved files

Run from the repository root with FFmpeg's `ffprobe` and `ffmpeg` on `PATH`:

```powershell
node app/scripts/verify-export.mjs <video-only.mp4> <audible.mp4>
```

Add `--codec=h264` (or `hevc`, `av1`) and `--sample-rate=44100` to check the
files were made with those Session Settings.

The check requires one HEVC, AV1 or H.264 video track in each file, AAC audio only in
the audible file, a JPEG cover-art thumbnail of at most 640 px in each file, a
duration close to two seconds, aligned track start/end times, successful video
and audio decoding, and non-silent audio. On macOS,
inspect `smoke-native-aac.mp4` in place of the audible file as a second run.
Also open each MP4 in a player and confirm that the frame number changes and
the audible version has a continuous tone. Record the runtime, codecs,
durations, playback result, and any unsupported-codec message in the PR.

For a full editor check, import a short clip and optional main audio into a
session, export from the editor in each runtime, and run `ffprobe` plus a
playback check on those files too. The synthetic page isolates the export
bridge; the editor check also covers media import and composition rendering.

## Full editor session check

Run `node app/scripts/create-editor-fixture.mjs <absolute-output-directory>`
from the repository root. This requires `ffmpeg` on `PATH`. It creates two
workspace directories, `video-only` and `with-audio`, each with a 320 x 320,
24 fps, two-second moving H.264 source and a `project.json` session. The audible
workspace also has a two-second, 48 kHz, 440 Hz WAV main audio source. Session
media paths are absolute, so rerun the generator if the workspace moves.

In the browser editor at `http://localhost:1420/`, choose **File → Import
Media** and select `video-only/moving-video.mp4`. Wait for `Imported 1 media
file(s) through Web.` Confirm that the editor created a two-second arrangement
clip and the Program panel shows `320 x 320`. Click **Export** and save the
video-only MP4. Then choose **File → Open → Session…** and select
`with-audio/project.json`. Wait for `Loaded project.json with local media
hydrated from disk.` Confirm the same arrangement clip and `MAIN-TONE.WAV` on the Audio
lane. Click **Export** again. The session supplies the main-audio selection;
importing a loose audio file does not assign it to the main audio track. The
browser's save picker may appear instead of a download.

In Windows Tauri, run the normal `tauri dev` application with the editor page.
Use **File → Import Media** to select `video-only/moving-video.mp4` in a blank
editor, then export the arranged video-only session. Reload the editor and use
**File → Open → Session…** to select `with-audio/project.json`. Wait for
local media hydration, confirm the arrangement clip and `MAIN-TONE.WAV` on the
Audio lane, then export through the native save dialog. On another supported
Tauri platform, use the same steps. To check session-file hydration without
loose import, open `video-only/project.json` as well.

Run `node app/scripts/verify-export.mjs <video-only-output.mp4>
<audible-output.mp4>` against each runtime's pair. Also open all four outputs
in a player: the numbered test pattern must move, and both audible exports
must play a continuous tone. Record the runtime and version, codec and track
summary, start times, duration, playback result, and any unsupported-codec
message. A file that merely saves without visible motion or audible sound does
not pass this check.
