# MP4 export smoke test

Use this when changing the zvidlib export bridge or either harness. It runs the
real `exportVideo` path with 48 changing canvas frames over two seconds. The
audible case supplies a 48 kHz, 440 Hz tone as master audio. The source is
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

Open `http://localhost:1420/export-smoke.html` in a browser with a HEVC or AV1
video encoder and an AAC audio encoder. Click **Export video only** and
**Export with audio**. Each button reports `Saved ...` on success; keep the two
downloaded MP4 files. If the runtime lacks HEVC/AV1 or AAC, record the exact
error and browser version. An unsupported encoder is a platform result, not a
passing export.

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

## Inspect and play the saved files

Run from the repository root with FFmpeg's `ffprobe` and `ffmpeg` on `PATH`:

```powershell
node app/scripts/verify-export.mjs <video-only.mp4> <audible.mp4>
```

The check requires one HEVC or AV1 video track in each file, AAC audio only in
the audible file, a duration close to two seconds, aligned track start/end
times, successful video and audio decoding, and non-silent audio. On macOS,
inspect `smoke-native-aac.mp4` in place of the audible file as a second run.
Also open each MP4 in a player and confirm that the frame number changes and
the audible version has a continuous tone. Record the runtime, codecs,
durations, playback result, and any unsupported-codec message in the PR.

For a full editor check, import a short clip and optional master audio into a
session, export from the editor in each runtime, and run `ffprobe` plus a
playback check on those files too. The synthetic page isolates the export
bridge; the editor check also covers media import and composition rendering.

## Full editor session check

Run `node app/scripts/create-editor-fixture.mjs <absolute-output-directory>`
from the repository root. This requires `ffmpeg` on `PATH`. It creates two
workspace directories, `video-only` and `with-audio`, each with a 320 x 320,
24 fps, two-second moving H.264 source and a `.lvp` session. The audible
workspace also has a two-second, 48 kHz, 440 Hz WAV master source. Session
media paths are absolute, so rerun the generator if the workspace moves.

In the browser editor at `http://localhost:1420/`, click **Open Workspace**
and choose the `video-only` directory. Wait for `Loaded video-only.lvp with
local media hydrated from disk.` Confirm the timeline has one selected clip and
the Program panel shows `320 x 320`. Click **Export** and save the MP4. Repeat
with the `with-audio` directory; confirm the Program panel lists
`master-tone.wav` before export. The browser's save picker may appear instead
of a download, depending on browser support.

In Windows Tauri, run the normal `tauri dev` application with the editor page.
Use **File → Open** to select `video-only/video-only.lvp` and then
`with-audio/with-audio.lvp` in separate runs. Wait for local media hydration,
confirm the same clip and Program panel state, click **Export**, and choose an
MP4 destination in the native save dialog. This uses the real native session
loader and save path. On another supported Tauri platform, use the same steps.

Run `node app/scripts/verify-export.mjs <video-only-output.mp4>
<audible-output.mp4>` against each runtime's pair. Also open all four outputs
in a player: the numbered test pattern must move, and both audible exports
must play a continuous tone. Record the runtime and version, codec and track
summary, start times, duration, playback result, and any unsupported-codec
message. A file that merely saves without visible motion or audible sound does
not pass this check.
