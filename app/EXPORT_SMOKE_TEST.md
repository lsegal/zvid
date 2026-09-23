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
