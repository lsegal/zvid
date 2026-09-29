#!/usr/bin/env node
// Inspect files saved by the browser and Tauri export flows, not encoder input.
import { spawnSync } from "node:child_process";

const [silentPath, audiblePath] = process.argv.slice(2);
if (!silentPath || !audiblePath) {
  console.error(
    "Usage: node app/scripts/verify-export.mjs <video-only.mp4> <audible.mp4>",
  );
  process.exit(2);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: null,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} failed: ${result.error?.message ?? result.stderr.toString()}`,
    );
  }
  return result.stdout;
}

function inspect(path, expectAudio) {
  const probe = JSON.parse(
    run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=index,codec_name,codec_type,duration,start_time,width,height:stream_disposition=attached_pic",
      "-of",
      "json",
      path,
    ]).toString(),
  );
  // ffprobe lists the MP4 cover art as a video stream with attached_pic set.
  const covers = probe.streams.filter(
    (stream) => stream.disposition?.attached_pic === 1,
  );
  const video = probe.streams.filter(
    (stream) =>
      stream.codec_type === "video" && stream.disposition?.attached_pic !== 1,
  );
  const audio = probe.streams.filter((stream) => stream.codec_type === "audio");
  if (video.length !== 1 || !["hevc", "av1"].includes(video[0].codec_name)) {
    throw new Error(`${path}: expected one HEVC or AV1 video track`);
  }
  if (
    covers.length !== 1 ||
    covers[0].codec_name !== "mjpeg" ||
    !(Math.max(covers[0].width, covers[0].height) <= 640)
  ) {
    throw new Error(`${path}: expected one JPEG cover of at most 640 px`);
  }
  if (audio.length !== (expectAudio ? 1 : 0)) {
    throw new Error(
      `${path}: expected ${expectAudio ? "one AAC" : "no"} audio track`,
    );
  }
  if (expectAudio && audio[0].codec_name !== "aac") {
    throw new Error(`${path}: audio track is not AAC`);
  }
  const duration = Number(probe.format.duration);
  if (!Number.isFinite(duration) || Math.abs(duration - 2) > 0.15) {
    throw new Error(`${path}: expected a two-second duration`);
  }
  for (const stream of [...video, ...audio]) {
    const start = Number(stream.start_time ?? 0);
    const end = start + Number(stream.duration ?? duration);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      Math.abs(start) > 0.15 ||
      Math.abs(end - duration) > 0.25
    ) {
      throw new Error(
        `${path}: ${stream.codec_type} timing differs from MP4 duration`,
      );
    }
  }
  run("ffmpeg", [
    "-v",
    "error",
    "-xerror",
    "-i",
    path,
    "-map",
    "0:V:0",
    "-f",
    "null",
    "-",
  ]);
  if (expectAudio) {
    const pcm = run("ffmpeg", [
      "-v",
      "error",
      "-xerror",
      "-i",
      path,
      "-map",
      "0:a:0",
      "-ac",
      "1",
      "-ar",
      "48000",
      "-f",
      "f32le",
      "-",
    ]);
    if (pcm.length < 48000 * 2 * 4) {
      throw new Error(`${path}: too few decoded audio samples`);
    }
    let sum = 0;
    for (let offset = 0; offset < pcm.length; offset += 4) {
      const value = pcm.readFloatLE(offset);
      sum += value * value;
    }
    const rms = Math.sqrt(sum / (pcm.length / 4));
    if (rms < 0.005)
      throw new Error(`${path}: AAC track is effectively silent`);
    console.log(
      `${path}: ${video[0].codec_name} + AAC, ${duration.toFixed(3)} s, audio RMS ${rms.toFixed(3)}, ${covers[0].width}x${covers[0].height} JPEG cover`,
    );
  } else {
    console.log(
      `${path}: ${video[0].codec_name}, ${duration.toFixed(3)} s, no audio, ${covers[0].width}x${covers[0].height} JPEG cover`,
    );
  }
  return duration;
}

try {
  const silentDuration = inspect(silentPath, false);
  const audibleDuration = inspect(audiblePath, true);
  if (Math.abs(silentDuration - audibleDuration) > 0.25) {
    throw new Error("Video-only and audible exports have different durations");
  }
  console.log("MP4 export smoke check passed");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
