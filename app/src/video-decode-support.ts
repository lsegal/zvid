// Checks up front whether this platform can decode a video codec, so a
// thumbnail for media it cannot decode goes to a fallback decoder or fails
// with a reason instead of timing out on a blank frame. ZVID Capture records
// HEVC or AV1, which Chrome, Edge and WebView2 often cannot decode.
import type { MediaItem } from "./media.ts";
import type { ThumbnailSize } from "./thumbnail-cache.ts";

// A thumbnail that cannot be made on this platform. Its message is the reason
// shown in place of the thumbnail.
export class ThumbnailUnavailableError extends Error {
  override name = "ThumbnailUnavailableError";
}

const CODEC_LABELS: [prefix: string, label: string][] = [
  ["hvc1", "HEVC"],
  ["hev1", "HEVC"],
  ["av01", "AV1"],
  ["avc1", "H.264"],
  ["avc3", "H.264"],
  ["vp09", "VP9"],
  ["vp8", "VP8"],
];

// A readable name for an RFC 6381 codec string such as `hvc1.1.6.L93.B0`.
export function describeVideoCodec(codec: string | undefined) {
  const label = CODEC_LABELS.find(([prefix]) => codec?.startsWith(prefix));
  return label?.[1] ?? codec?.split(".")[0] ?? "this";
}

export function describeUndecodableVideo(codec: string | undefined) {
  return `Can't decode ${describeVideoCodec(codec)} video on this platform`;
}

export type VideoFormat = {
  width?: number;
  height?: number;
  fps?: number;
};

export type VideoPlaybackProbe = {
  mediaCapabilities?: Pick<MediaCapabilities, "decodingInfo">;
  canPlayType?: (contentType: string) => string;
};

export type CanPlayVideoCodec = (
  codec: string | undefined,
  format?: VideoFormat,
) => Promise<boolean>;

// Answers whether a media element can play `codec`, remembering each answer.
// A codec that is unknown, or a platform that cannot say, is assumed playable
// so the media element still gets to try.
export function createCanPlayVideoCodec(
  probe: VideoPlaybackProbe,
): CanPlayVideoCodec {
  const answers = new Map<string, Promise<boolean>>();

  const ask = async (codec: string, format: VideoFormat) => {
    const contentType = `video/mp4; codecs="${codec}"`;
    if (probe.mediaCapabilities) {
      try {
        const info = await probe.mediaCapabilities.decodingInfo({
          type: "file",
          video: {
            contentType,
            width: format.width || 1920,
            height: format.height || 1080,
            bitrate: 8_000_000,
            framerate: format.fps || 30,
          },
        });
        return info.supported;
      } catch {
        // Some engines reject codec strings they do not know; fall through.
      }
    }
    if (probe.canPlayType) {
      return probe.canPlayType(contentType) !== "";
    }
    return true;
  };

  return (codec, format = {}) => {
    if (!codec) {
      return Promise.resolve(true);
    }

    let answer = answers.get(codec);
    if (!answer) {
      answer = ask(codec, format);
      answers.set(codec, answer);
    }
    return answer;
  };
}

let defaultCanPlayVideoCodec: CanPlayVideoCodec | undefined;

export const canPlayVideoCodec: CanPlayVideoCodec = (codec, format) => {
  defaultCanPlayVideoCodec ??= createCanPlayVideoCodec({
    mediaCapabilities:
      typeof navigator === "undefined" ? undefined : navigator.mediaCapabilities,
    canPlayType:
      typeof document === "undefined"
        ? undefined
        : (contentType) =>
            document.createElement("video").canPlayType(contentType),
  });
  return defaultCanPlayVideoCodec(codec, format);
};

type ProbedVideoTrack = {
  getCodecParameterString(): Promise<string | null>;
  canDecode(): Promise<boolean>;
};

// The track's codec string, and whether WebCodecs can decode it here.
export async function probeVideoTrack(track: ProbedVideoTrack) {
  const [codec, canDecode] = await Promise.all([
    track.getCodecParameterString().catch(() => null),
    track.canDecode().catch(() => false),
  ]);
  return { codec: codec ?? undefined, canDecode };
}

export type VideoThumbnailDecoders = {
  canPlay: CanPlayVideoCodec;
  // Decodes through a media element, which is the fast path.
  fromMediaElement: (
    media: MediaItem,
    timeSeconds: number,
    size?: ThumbnailSize,
  ) => Promise<string | undefined>;
  // Decodes without the platform's media stack, e.g. zvidlib in Tauri. Used
  // only when the media element cannot decode the codec.
  fallback?: (
    media: MediaItem,
    timeSeconds: number,
    size?: ThumbnailSize,
  ) => Promise<string | undefined>;
};

// Makes a thumbnail through the media element when it can decode the media,
// and through the fallback decoder otherwise. Throws a
// `ThumbnailUnavailableError` naming the reason when neither can.
export async function generateVideoThumbnail(
  media: MediaItem,
  timeSeconds: number,
  size: ThumbnailSize | undefined,
  decoders: VideoThumbnailDecoders,
) {
  if (!media.hasVideo) {
    return undefined;
  }

  if (await decoders.canPlay(media.videoCodec, media)) {
    return decoders.fromMediaElement(media, timeSeconds, size);
  }

  const reason = describeUndecodableVideo(media.videoCodec);
  if (!decoders.fallback) {
    throw new ThumbnailUnavailableError(reason);
  }

  let url: string | undefined;
  try {
    url = await decoders.fallback(media, timeSeconds, size);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ThumbnailUnavailableError(
      detail ? `${reason}: ${detail}` : reason,
    );
  }
  if (!url) {
    throw new ThumbnailUnavailableError(reason);
  }
  return url;
}
