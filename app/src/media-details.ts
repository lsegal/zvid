// File details of a media item (size, container, codecs, bitrate), read from
// its container metadata without decoding, and their people-facing text.

import type { Input } from "mediabunny";
import { formatFileSize } from "./export-options.ts";
import type { MediaItem } from "./media.ts";

export type MediaDetails = Pick<
  MediaItem,
  "fileSizeBytes" | "container" | "videoCodec" | "audioCodec" | "bitrate"
>;

// Shown for a detail that is not known.
export const MISSING_DETAIL = "—";

const CONTAINER_NAMES: Record<string, string> = {
  MP4: "MP4",
  "QuickTime File Format": "QuickTime / MOV",
  Matroska: "Matroska / MKV",
  WebM: "WebM",
  MP3: "MP3",
  WAVE: "WAV",
  Ogg: "Ogg",
  FLAC: "FLAC",
  ADTS: "AAC / ADTS",
  "MPEG Transport Stream": "MPEG-TS",
};

const CODEC_NAMES: Record<string, string> = {
  avc: "H.264",
  hevc: "HEVC",
  vp8: "VP8",
  vp9: "VP9",
  av1: "AV1",
  prores: "ProRes",
  aac: "AAC",
  opus: "Opus",
  mp3: "MP3",
  vorbis: "Vorbis",
  flac: "FLAC",
  ac3: "AC-3",
  eac3: "E-AC-3",
  dts: "DTS",
  ulaw: "μ-law",
  alaw: "A-law",
};

/** mediabunny's "QuickTime File Format" → "QuickTime / MOV". */
export function containerDisplayName(formatName: string) {
  return CONTAINER_NAMES[formatName] ?? formatName;
}

/** mediabunny's "avc" → "H.264", any "pcm-*" → "PCM". */
export function codecDisplayName(codec: string) {
  if (codec.startsWith("pcm-")) {
    return "PCM";
  }
  return CODEC_NAMES[codec] ?? codec.toUpperCase();
}

// Media that has never had its details read: the size is known whenever
// they were.
export function hasMediaDetails(item: Pick<MediaItem, "fileSizeBytes">) {
  return item.fileSizeBytes !== undefined;
}

async function readFileSize(input: Input) {
  try {
    return (await input.source.getSizeOrNull()) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * The details of `input` lasting `durationSeconds`. The bitrate is the
 * overall one when the file size is known, else the tracks' measured from
 * their first packets.
 */
export async function probeMediaDetails(
  input: Input,
  durationSeconds: number,
): Promise<MediaDetails> {
  const format = await input.getFormat();
  const videoTrack = await input.getPrimaryVideoTrack();
  const audioTrack = await input.getPrimaryAudioTrack();
  const fileSizeBytes = await readFileSize(input);

  let bitrate: number | undefined;
  if (fileSizeBytes !== undefined && durationSeconds > 0) {
    bitrate = Math.round((fileSizeBytes * 8) / durationSeconds);
  } else {
    let total = 0;
    for (const track of [videoTrack, audioTrack]) {
      total += track ? (await track.computePacketStats(240)).averageBitrate : 0;
    }
    bitrate = total > 0 ? Math.round(total) : undefined;
  }

  return {
    fileSizeBytes,
    container: containerDisplayName(format.name),
    videoCodec: videoTrack?.codec
      ? codecDisplayName(videoTrack.codec)
      : undefined,
    audioCodec: audioTrack?.codec
      ? codecDisplayName(audioTrack.codec)
      : undefined,
    bitrate,
  };
}

// Drops trailing zeros: 29.970 → "29.97", 30.00 → "30".
function trimNumber(value: number, digits: number) {
  return String(Number(value.toFixed(digits)));
}

/** `21_212_345` → "21.2 MB". */
export function formatMediaFileSize(bytes: number | undefined) {
  return bytes === undefined ? MISSING_DETAIL : formatFileSize(bytes);
}

/** A container or codec name, or "—". */
export function formatMediaDetail(text: string | undefined) {
  return text || MISSING_DETAIL;
}

/** "1128 × 1080". */
export function formatMediaDimensions(
  width: number | undefined,
  height: number | undefined,
) {
  return width && height ? `${width} × ${height}` : MISSING_DETAIL;
}

/** `30000 / 1001` → "29.97 fps". */
export function formatMediaFps(fps: number | undefined) {
  return fps && fps > 0 ? `${trimNumber(fps, 2)} fps` : MISSING_DETAIL;
}

function formatChannels(channels: number) {
  switch (channels) {
    case 1:
      return "Mono";
    case 2:
      return "Stereo";
    case 6:
      return "5.1";
    case 8:
      return "7.1";
    default:
      return `${channels} ch`;
  }
}

/** "48 kHz · Stereo". */
export function formatMediaAudio(
  sampleRate: number | undefined,
  channels: number | undefined,
) {
  const parts = [
    sampleRate ? `${trimNumber(sampleRate / 1000, 1)} kHz` : undefined,
    channels ? formatChannels(channels) : undefined,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : MISSING_DETAIL;
}

/** `128_000` → "128 kbps", `12_345_678` → "12.3 Mbps". */
export function formatMediaBitrate(bitsPerSecond: number | undefined) {
  if (!bitsPerSecond || bitsPerSecond <= 0) {
    return MISSING_DETAIL;
  }
  if (bitsPerSecond < 1_000_000) {
    return `${Math.max(1, Math.round(bitsPerSecond / 1000))} kbps`;
  }
  return `${trimNumber(bitsPerSecond / 1_000_000, 1)} Mbps`;
}
