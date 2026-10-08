// The encoder configuration an export uses, derived from the session's
// Session Settings: which video codec the device encodes with, the container
// and audio codec that codec exports to, and the video and audio bitrates and
// audio sample rate.

import {
  AUTO_CODEC_ORDER,
  type EncodableVideoCodec,
  type ExportAudioCodec,
  type ExportContainer,
  exportAudioCodec,
  exportAudioSampleRate,
  exportContainer,
  type SessionSettings,
  videoBitrateMbps,
} from "../session-settings.ts";

export type ExportEncoding = {
  container: ExportContainer;
  videoCodec: EncodableVideoCodec;
  // Bits per second.
  videoBitrate: number;
  audioCodec: ExportAudioCodec;
  // Bits per second.
  audioBitrate: number;
  audioSampleRate: number;
};

export const VIDEO_CODEC_LABELS: Record<EncodableVideoCodec, string> = {
  h264: "H.264",
  hevc: "HEVC",
  av1: "AV1",
  vp8: "VP8",
  vp9: "VP9",
};

// Mediabunny's names for the codecs.
export const MEDIABUNNY_VIDEO_CODECS = {
  h264: "avc",
  hevc: "hevc",
  av1: "av1",
  vp8: "vp8",
  vp9: "vp9",
} as const satisfies Record<EncodableVideoCodec, string>;

/** Whether the device can encode `codec` at the given size and bitrate. */
export type CanEncodeVideo = (
  codec: EncodableVideoCodec,
  config: { width: number; height: number; bitrate: number },
) => Promise<boolean>;

/**
 * The encoding the settings export with. Auto takes the first codec in
 * `AUTO_CODEC_ORDER` the device can encode; an explicit codec the device
 * can't encode fails before anything renders.
 */
export async function resolveExportEncoding(
  settings: SessionSettings,
  canEncode: CanEncodeVideo,
): Promise<ExportEncoding> {
  const { encoding } = settings;
  const config = {
    width: settings.canvasWidth,
    height: settings.canvasHeight,
    bitrate: Math.round(videoBitrateMbps(settings) * 1_000_000),
  };
  let videoCodec: EncodableVideoCodec | undefined;
  if (encoding.videoCodec === "auto") {
    for (const codec of AUTO_CODEC_ORDER) {
      if (await canEncode(codec, config)) {
        videoCodec = codec;
        break;
      }
    }
    if (!videoCodec)
      throw new Error(
        "MP4 export requires an HEVC, AV1 or H.264 encoder on this device.",
      );
  } else {
    videoCodec = encoding.videoCodec;
    if (!(await canEncode(videoCodec, config)))
      throw new Error(
        `${VIDEO_CODEC_LABELS[videoCodec]} encoding at ${settings.canvasWidth}×${settings.canvasHeight} is not supported on this device. Choose Auto in Session Settings to export with the best available codec.`,
      );
  }
  const container = exportContainer(videoCodec);
  return {
    container,
    videoCodec,
    videoBitrate: config.bitrate,
    audioCodec: exportAudioCodec(container),
    audioBitrate: encoding.audioBitrateKbps * 1000,
    audioSampleRate: exportAudioSampleRate(encoding),
  };
}

function formatNumber(value: number) {
  return String(Math.round(value * 100) / 100);
}

/** The export's effective settings, like "1080×1920 · 30 fps · HEVC · 12 Mbps". */
export function describeExportEncoding(
  settings: SessionSettings,
  encoding: ExportEncoding,
) {
  return [
    `${settings.canvasWidth}×${settings.canvasHeight}`,
    `${formatNumber(settings.fps)} fps`,
    VIDEO_CODEC_LABELS[encoding.videoCodec],
    `${formatNumber(encoding.videoBitrate / 1_000_000)} Mbps`,
  ].join(" · ");
}
