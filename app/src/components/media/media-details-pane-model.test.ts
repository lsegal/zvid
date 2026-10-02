import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MediaItem } from "../../media";
import {
  formatMediaModified,
  getMediaDetailRows,
} from "./media-details-pane-model.ts";

function media(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: "m1",
    name: "clip.mov",
    kind: "video",
    durationSeconds: 12,
    width: 1128,
    height: 1080,
    fps: 30000 / 1001,
    sampleRate: 48_000,
    channels: 2,
    hasAudio: true,
    hasVideo: true,
    fileSizeBytes: 21_212_345,
    container: "QuickTime / MOV",
    videoCodec: "H.264",
    audioCodec: "AAC",
    bitrate: 12_345_678,
    lastModified: Date.UTC(2026, 9, 1, 12, 0),
    color: "#000",
    accent: "#fff",
    previewUrl: "blob:clip",
    availability: "ready",
    ...overrides,
  };
}

function rowMap(item: MediaItem) {
  return new Map(
    getMediaDetailRows(item, "0:12", "en-US").map((row) => [
      row.label,
      row.value,
    ]),
  );
}

describe("media details pane rows", () => {
  it("lists every detail of video with audio, formatted for people", () => {
    const rows = getMediaDetailRows(media(), "0:12", "en-US");
    assert.deepEqual(
      rows.map((row) => row.label),
      [
        "Name",
        "Kind",
        "Size",
        "Container",
        "Video",
        "Audio",
        "Duration",
        "Bitrate",
        "Modified",
      ],
    );
    const values = rowMap(media());
    assert.equal(values.get("Name"), "clip.mov");
    assert.equal(values.get("Kind"), "Video + Audio");
    assert.equal(values.get("Size"), "21.2 MB");
    assert.equal(values.get("Container"), "QuickTime / MOV");
    assert.equal(values.get("Video"), "H.264 · 1128 × 1080 · 29.97 fps");
    assert.equal(values.get("Audio"), "AAC · 48 kHz · Stereo");
    assert.equal(values.get("Duration"), "0:12");
    assert.equal(values.get("Bitrate"), "12.3 Mbps");
    assert.match(values.get("Modified") ?? "", /2026/);
  });

  it("hides the video row of audio-only media", () => {
    const values = rowMap(
      media({ kind: "audio", hasVideo: false, width: undefined }),
    );
    assert.equal(values.has("Video"), false);
    assert.equal(values.get("Audio"), "AAC · 48 kHz · Stereo");
  });

  it("hides the audio row of video-only media", () => {
    const values = rowMap(media({ hasAudio: false }));
    assert.equal(values.has("Audio"), false);
    assert.equal(values.has("Video"), true);
  });

  it("shows — for details that are not known", () => {
    const values = rowMap(
      media({
        fileSizeBytes: undefined,
        container: undefined,
        videoCodec: undefined,
        audioCodec: undefined,
        width: undefined,
        fps: undefined,
        sampleRate: undefined,
        channels: undefined,
        bitrate: undefined,
        lastModified: undefined,
      }),
    );
    for (const label of [
      "Size",
      "Container",
      "Video",
      "Audio",
      "Bitrate",
      "Modified",
    ]) {
      assert.equal(values.get(label), "—", label);
    }
  });

  it("keeps the known parts of a partly known track", () => {
    const values = rowMap(media({ videoCodec: undefined, fps: undefined }));
    assert.equal(values.get("Video"), "1128 × 1080");
  });

  it("shows offline media's state and last known file name, not its path", () => {
    const values = rowMap(
      media({
        availability: "offline",
        sourcePath: "C:\\Users\\someone\\Movies\\take-3.mov",
      }),
    );
    assert.equal(values.get("Status"), "Offline");
    assert.equal(values.get("Last known file"), "take-3.mov");
    assert.equal(values.get("Size"), "21.2 MB");
    const online = rowMap(media({ sourcePath: "/Users/someone/take-3.mov" }));
    assert.equal(online.has("Status"), false);
    assert.equal(online.has("Last known file"), false);
  });

  it("formats the modified date or —", () => {
    assert.equal(formatMediaModified(undefined), "—");
    assert.equal(formatMediaModified(Number.NaN), "—");
    assert.match(
      formatMediaModified(Date.UTC(2026, 0, 15, 12), "en-US"),
      /Jan 15, 2026/,
    );
  });
});
