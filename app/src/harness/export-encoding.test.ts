import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SESSION_SETTINGS,
  type EncodableVideoCodec,
  presetBitrateMbps,
  type SessionEncoding,
  type SessionSettings,
} from "../session-settings.ts";
import {
  type CanEncodeVideo,
  describeExportEncoding,
  resolveExportEncoding,
} from "./export-encoding.ts";

function settings(
  encoding: Partial<SessionEncoding> = {},
  size: Partial<SessionSettings> = {},
): SessionSettings {
  return {
    ...DEFAULT_SESSION_SETTINGS,
    ...size,
    encoding: { ...DEFAULT_SESSION_SETTINGS.encoding, ...encoding },
  };
}

// A device that can encode only `codecs`, recording what it was asked.
function device(...codecs: EncodableVideoCodec[]) {
  const asked: Parameters<CanEncodeVideo>[] = [];
  const canEncode: CanEncodeVideo = async (codec, config) => {
    asked.push([codec, config]);
    return codecs.includes(codec);
  };
  return { canEncode, asked };
}

describe("resolveExportEncoding", () => {
  it("maps the default settings to HEVC at 12 Mbps with AAC 192 kbps 48 kHz", async () => {
    const { canEncode, asked } = device("hevc", "av1", "h264");
    const encoding = await resolveExportEncoding(settings(), canEncode);
    assert.deepEqual(encoding, {
      container: "mp4",
      videoCodec: "hevc",
      videoBitrate: 12_000_000,
      audioCodec: "aac",
      audioBitrate: 192_000,
      audioSampleRate: 48_000,
    });
    assert.deepEqual(asked, [
      ["hevc", { width: 1920, height: 1080, bitrate: 12_000_000 }],
    ]);
  });

  it("falls back from HEVC to AV1 to H.264 on Auto", async () => {
    assert.equal(
      (await resolveExportEncoding(settings(), device("av1", "h264").canEncode))
        .videoCodec,
      "av1",
    );
    const { canEncode, asked } = device("h264");
    assert.equal(
      (await resolveExportEncoding(settings(), canEncode)).videoCodec,
      "h264",
    );
    assert.deepEqual(
      asked.map(([codec]) => codec),
      ["hevc", "av1", "h264"],
    );
  });

  it("fails when Auto finds no encoder", async () => {
    await assert.rejects(
      resolveExportEncoding(settings(), device().canEncode),
      /requires an HEVC, AV1 or H\.264 encoder/,
    );
  });

  it("uses an explicit codec without probing the others", async () => {
    const { canEncode, asked } = device("hevc", "av1", "h264");
    const encoding = await resolveExportEncoding(
      settings({ videoCodec: "h264" }),
      canEncode,
    );
    assert.equal(encoding.videoCodec, "h264");
    assert.deepEqual(
      asked.map(([codec]) => codec),
      ["h264"],
    );
  });

  it("rejects an unsupported explicit codec and suggests Auto", async () => {
    await assert.rejects(
      resolveExportEncoding(
        settings(
          { videoCodec: "hevc" },
          { canvasWidth: 1080, canvasHeight: 1920 },
        ),
        device("av1", "h264").canEncode,
      ),
      {
        message:
          "HEVC encoding at 1080×1920 is not supported on this device. Choose Auto in Session Settings to export with the best available codec.",
      },
    );
  });

  it("takes the bitrate from the quality preset for the size and frame rate", async () => {
    const { canEncode } = device("av1");
    const low = await resolveExportEncoding(
      settings({ quality: "low" }),
      canEncode,
    );
    const fourK = await resolveExportEncoding(
      settings({}, { canvasWidth: 3840, canvasHeight: 2160 }),
      canEncode,
    );
    assert.equal(
      low.videoBitrate,
      presetBitrateMbps(1920, 1080, 30, "low") * 1_000_000,
    );
    assert.equal(
      fourK.videoBitrate,
      presetBitrateMbps(3840, 2160, 30, "high") * 1_000_000,
    );
  });

  it("uses a custom bitrate and the audio settings", async () => {
    const encoding = await resolveExportEncoding(
      settings({
        quality: "custom",
        customBitrateMbps: 2.5,
        audioBitrateKbps: 320,
        audioSampleRate: 44100,
      }),
      device("av1").canEncode,
    );
    assert.equal(encoding.videoBitrate, 2_500_000);
    assert.equal(encoding.audioBitrate, 320_000);
    assert.equal(encoding.audioSampleRate, 44_100);
  });

  for (const videoCodec of ["vp8", "vp9"] as const) {
    it(`exports ${videoCodec} to WebM with 48 kHz Opus`, async () => {
      const { canEncode, asked } = device("hevc", videoCodec);
      const encoding = await resolveExportEncoding(
        settings({ videoCodec, audioBitrateKbps: 128, audioSampleRate: 44100 }),
        canEncode,
      );
      assert.deepEqual(encoding, {
        container: "webm",
        videoCodec,
        videoBitrate: 12_000_000,
        audioCodec: "opus",
        audioBitrate: 128_000,
        // Opus always codes 48 kHz.
        audioSampleRate: 48_000,
      });
      assert.deepEqual(
        asked.map(([codec]) => codec),
        [videoCodec],
      );
    });
  }

  it("keeps Auto on MP4 even when only VP9 can encode", async () => {
    await assert.rejects(
      resolveExportEncoding(settings(), device("vp8", "vp9").canEncode),
      /requires an HEVC, AV1 or H\.264 encoder/,
    );
  });
});

describe("describeExportEncoding", () => {
  it("lists the size, frame rate, codec and bitrate", async () => {
    const vertical = settings({}, { canvasWidth: 1080, canvasHeight: 1920 });
    const encoding = await resolveExportEncoding(
      vertical,
      device("hevc").canEncode,
    );
    assert.equal(
      describeExportEncoding(vertical, encoding),
      `1080×1920 · 30 fps · HEVC · ${encoding.videoBitrate / 1_000_000} Mbps`,
    );
  });

  it("rounds fractional frame rates and bitrates", () => {
    assert.equal(
      describeExportEncoding(settings({}, { fps: 30000 / 1001 }), {
        container: "mp4",
        videoCodec: "h264",
        videoBitrate: 4_500_000,
        audioCodec: "aac",
        audioBitrate: 192_000,
        audioSampleRate: 48_000,
      }),
      "1920×1080 · 29.97 fps · H.264 · 4.5 Mbps",
    );
  });
});
