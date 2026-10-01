import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ALL_FORMATS, BufferSource, Input } from "mediabunny";
import { type MediaItem, toShareableMediaItem } from "./media.ts";
import {
  codecDisplayName,
  containerDisplayName,
  formatMediaAudio,
  formatMediaBitrate,
  formatMediaDetail,
  formatMediaDimensions,
  formatMediaFileSize,
  formatMediaFps,
  hasMediaDetails,
  MISSING_DETAIL,
  probeMediaDetails,
} from "./media-details.ts";

// ~320p, 3 s fixtures.
async function probeFixture(path: string) {
  const bytes = readFileSync(
    new URL(`../test/fixtures/${path}`, import.meta.url),
  );
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BufferSource(bytes),
  });
  try {
    const durationSeconds = await input.computeDuration();
    return {
      bytes: bytes.byteLength,
      durationSeconds,
      details: await probeMediaDetails(input, durationSeconds),
    };
  } finally {
    input.dispose();
  }
}

describe("probeMediaDetails", () => {
  it("reads an H.264 + AAC mp4", async () => {
    const { bytes, durationSeconds, details } = await probeFixture(
      "video/h264-aac-320x180-29.97.mp4",
    );
    assert.equal(details.fileSizeBytes, bytes);
    assert.equal(details.container, "MP4");
    assert.equal(details.videoCodec, "H.264");
    assert.equal(details.audioCodec, "AAC");
    assert.equal(details.bitrate, Math.round((bytes * 8) / durationSeconds));
  });

  it("reads a video-only mp4", async () => {
    const { bytes, details } = await probeFixture(
      "video/landscape-320x180-29.97.mp4",
    );
    assert.equal(details.fileSizeBytes, bytes);
    assert.equal(details.container, "MP4");
    assert.equal(details.videoCodec, "H.264");
    assert.equal(details.audioCodec, undefined);
    assert.ok(details.bitrate && details.bitrate > 0);
  });

  it("reads an audio-only wav", async () => {
    const { bytes, details } = await probeFixture(
      "audio/tone-8khz-mono-3s.wav",
    );
    assert.equal(details.fileSizeBytes, bytes);
    assert.equal(details.container, "WAV");
    assert.equal(details.videoCodec, undefined);
    assert.equal(details.audioCodec, "PCM");
    // 8 kHz, 16-bit mono, plus the header.
    assert.ok(details.bitrate && Math.abs(details.bitrate - 128_000) < 1_000);
  });
});

describe("display names", () => {
  it("names containers", () => {
    assert.equal(
      containerDisplayName("QuickTime File Format"),
      "QuickTime / MOV",
    );
    assert.equal(containerDisplayName("MP4"), "MP4");
    assert.equal(containerDisplayName("WAVE"), "WAV");
    assert.equal(containerDisplayName("Something New"), "Something New");
  });

  it("names codecs", () => {
    assert.equal(codecDisplayName("avc"), "H.264");
    assert.equal(codecDisplayName("hevc"), "HEVC");
    assert.equal(codecDisplayName("prores"), "ProRes");
    assert.equal(codecDisplayName("vp9"), "VP9");
    assert.equal(codecDisplayName("av1"), "AV1");
    assert.equal(codecDisplayName("aac"), "AAC");
    assert.equal(codecDisplayName("pcm-s16"), "PCM");
    assert.equal(codecDisplayName("pcm-f32be"), "PCM");
    assert.equal(codecDisplayName("mp3"), "MP3");
    assert.equal(codecDisplayName("opus"), "Opus");
    assert.equal(codecDisplayName("xyz"), "XYZ");
  });
});

describe("formatting", () => {
  it("formats sizes", () => {
    assert.equal(formatMediaFileSize(21_212_345), "21.2 MB");
    assert.equal(formatMediaFileSize(48_078), "48 KB");
    assert.equal(formatMediaFileSize(undefined), MISSING_DETAIL);
  });

  it("formats dimensions", () => {
    assert.equal(formatMediaDimensions(1128, 1080), "1128 × 1080");
    assert.equal(formatMediaDimensions(undefined, 1080), MISSING_DETAIL);
  });

  it("formats frame rates", () => {
    assert.equal(formatMediaFps(30000 / 1001), "29.97 fps");
    assert.equal(formatMediaFps(30), "30 fps");
    assert.equal(formatMediaFps(24000 / 1001), "23.98 fps");
    assert.equal(formatMediaFps(undefined), MISSING_DETAIL);
  });

  it("formats audio", () => {
    assert.equal(formatMediaAudio(48_000, 2), "48 kHz · Stereo");
    assert.equal(formatMediaAudio(44_100, 1), "44.1 kHz · Mono");
    assert.equal(formatMediaAudio(48_000, 6), "48 kHz · 5.1");
    assert.equal(formatMediaAudio(48_000, 3), "48 kHz · 3 ch");
    assert.equal(formatMediaAudio(48_000, undefined), "48 kHz");
    assert.equal(formatMediaAudio(undefined, undefined), MISSING_DETAIL);
  });

  it("formats bitrates", () => {
    assert.equal(formatMediaBitrate(128_000), "128 kbps");
    assert.equal(formatMediaBitrate(12_345_678), "12.3 Mbps");
    assert.equal(formatMediaBitrate(8_000_000), "8 Mbps");
    assert.equal(formatMediaBitrate(undefined), MISSING_DETAIL);
  });

  it("formats names", () => {
    assert.equal(formatMediaDetail("H.264"), "H.264");
    assert.equal(formatMediaDetail(undefined), MISSING_DETAIL);
  });
});

describe("saved media", () => {
  const base: MediaItem = {
    id: "clip.mp4:1:2",
    name: "clip.mp4",
    kind: "video",
    durationSeconds: 3,
    hasAudio: true,
    hasVideo: true,
    color: "#000",
    accent: "#fff",
    previewUrl: "blob:local",
    availability: "ready",
  };

  it("loads media saved before details were read", () => {
    const restored = toShareableMediaItem(JSON.parse(JSON.stringify(base)));
    assert.equal(restored.fileSizeBytes, undefined);
    assert.equal(restored.container, undefined);
    assert.equal(hasMediaDetails(restored), false);
  });

  it("saves and shares the details", () => {
    const item: MediaItem = {
      ...base,
      fileSizeBytes: 39_352,
      container: "MP4",
      videoCodec: "H.264",
      audioCodec: "AAC",
      bitrate: 104_939,
      lastModified: 1_790_000_000_000,
    };
    const shared = toShareableMediaItem(JSON.parse(JSON.stringify(item)));
    assert.equal(shared.previewUrl, "");
    assert.equal(shared.fileSizeBytes, 39_352);
    assert.equal(shared.container, "MP4");
    assert.equal(shared.videoCodec, "H.264");
    assert.equal(shared.audioCodec, "AAC");
    assert.equal(shared.bitrate, 104_939);
    assert.equal(shared.lastModified, 1_790_000_000_000);
    assert.equal(hasMediaDetails(shared), true);
  });
});
