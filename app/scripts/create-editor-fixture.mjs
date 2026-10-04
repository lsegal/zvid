import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const directory = resolve(process.argv[2] ?? "editor-export-fixture");
mkdirSync(directory, { recursive: true });

function ffmpeg(args) {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", ...args],
    {
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`ffmpeg exited with ${result.status}`);
}

const videoPath = resolve(directory, "moving-video.mp4");
const audioPath = resolve(directory, "main-tone.wav");
ffmpeg([
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=320x320:rate=24:duration=2",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-an",
  videoPath,
]);
ffmpeg([
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:sample_rate=48000:duration=2",
  "-c:a",
  "pcm_s16le",
  audioPath,
]);

function session(video, audio) {
  return {
    mainTracks: [{ id: "main", name: "Main", colorIndex: 0 }],
    tracks: [
      {
        id: "source",
        name: "Moving video",
        colorIndex: 0,
        recordings: [{ filename: video }],
      },
    ],
    clips: [
      {
        id: "clip",
        trackId: "source",
        name: "Moving video",
        frameStart: 0,
        frameCount: 48,
        filePath: video,
      },
    ],
    selections: [
      {
        id: 1,
        trackId: "source",
        mainTrackId: "main",
        frameStart: 0,
        frameEnd: 48,
        selected: true,
      },
    ],
    timeline: { bpm: 120, fps: 24, canvasWidth: 320, canvasHeight: 320 },
    ...(audio ? { audioFilename: audio } : {}),
  };
}

for (const [name, withAudio] of [
  ["video-only", false],
  ["with-audio", true],
]) {
  const workspace = resolve(directory, name);
  mkdirSync(workspace, { recursive: true });
  const video = resolve(workspace, "moving-video.mp4");
  copyFileSync(videoPath, video);
  const audio = withAudio ? resolve(workspace, "main-tone.wav") : undefined;
  if (audio) copyFileSync(audioPath, audio);
  writeFileSync(
    resolve(workspace, "project.json"),
    `${JSON.stringify(session(video, audio), null, 2)}\n`,
  );
}
console.log(directory);
