import type { ServerMediaRef } from "./session";

export type MediaKind = "video" | "audio";

export type Palette = {
  color: string;
  accent: string;
};

export type MediaAvailability = "offline" | "hydrating" | "ready";

export type MediaItem = {
  id: string;
  name: string;
  kind: MediaKind;
  durationSeconds: number;
  width?: number;
  height?: number;
  fps?: number;
  sampleRate?: number;
  channels?: number;
  hasAudio: boolean;
  hasVideo: boolean;
  // File details, undefined until read and when unknown; see media-details.
  fileSizeBytes?: number;
  // People-facing names, like "QuickTime / MOV", "H.264" and "AAC".
  container?: string;
  videoCodec?: string;
  audioCodec?: string;
  // Overall bits per second.
  bitrate?: number;
  // Epoch milliseconds the file was last modified, when known.
  lastModified?: number;
  color: string;
  accent: string;
  previewUrl: string;
  thumbnailUrl?: string;
  sourcePath?: string;
  availability: MediaAvailability;
  // The In and Out points to use when the media goes into the timeline, in
  // seconds from the start of the file. Without them it uses the whole file.
  rangeInSeconds?: number;
  rangeOutSeconds?: number;
  // Local-only reason the last attempt to link this media failed.
  lastError?: string;
};

export type MediaProbeResult = {
  durationSeconds: number;
  width?: number;
  height?: number;
};

const MEDIA_PROBE_TIMEOUT_MS = 10_000;

function describeMediaError(error: MediaError | null) {
  switch (error?.code) {
    case MediaError.MEDIA_ERR_DECODE:
      return "File is corrupt or could not be decoded";
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "Not a media file or unsupported codec";
    case MediaError.MEDIA_ERR_NETWORK:
      return "File could not be read";
    case MediaError.MEDIA_ERR_ABORTED:
      return "Loading was aborted";
    default:
      return "File could not be loaded";
  }
}

// Loads a blob into a detached media element to confirm the browser can
// decode it, resolving with its metadata or rejecting with a readable reason.
export function probeMediaBlob(
  blob: Blob,
  kind: MediaKind,
): Promise<MediaProbeResult> {
  if (blob.size === 0) {
    return Promise.reject(new Error("File is empty"));
  }

  return new Promise((resolve, reject) => {
    const element = document.createElement(kind);
    const url = URL.createObjectURL(blob);
    let settled = false;

    const cleanup = () => {
      settled = true;
      window.clearTimeout(timeoutId);
      element.removeEventListener("loadedmetadata", handleLoadedMetadata);
      element.removeEventListener("error", handleError);
      element.removeAttribute("src");
      element.load();
      URL.revokeObjectURL(url);
    };

    const handleLoadedMetadata = () => {
      if (settled) {
        return;
      }
      const durationSeconds = Number.isFinite(element.duration)
        ? Math.max(0, element.duration)
        : 0;
      const hasVideo =
        element instanceof HTMLVideoElement &&
        element.videoWidth > 0 &&
        element.videoHeight > 0;
      const result: MediaProbeResult = {
        durationSeconds,
        width: hasVideo ? element.videoWidth : undefined,
        height: hasVideo ? element.videoHeight : undefined,
      };
      cleanup();
      resolve(result);
    };

    const handleError = () => {
      if (settled) {
        return;
      }
      const reason = describeMediaError(element.error);
      cleanup();
      reject(new Error(reason));
    };

    const timeoutId = window.setTimeout(() => {
      if (settled) {
        return;
      }
      cleanup();
      reject(new Error("Timed out loading media"));
    }, MEDIA_PROBE_TIMEOUT_MS);

    element.preload = "metadata";
    element.addEventListener("loadedmetadata", handleLoadedMetadata);
    element.addEventListener("error", handleError);
    element.src = url;
  });
}

export function createMediaId(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function inferMediaKind(name: string): MediaKind {
  const extension = name
    .slice(Math.max(0, name.lastIndexOf(".")))
    .toLowerCase();
  switch (extension) {
    case ".wav":
    case ".mp3":
    case ".m4a":
    case ".flac":
    case ".aif":
    case ".aiff":
      return "audio";
    default:
      return "video";
  }
}

function isShareableMediaUrl(url: string | undefined) {
  if (!url) {
    return false;
  }

  return (
    url.startsWith("/") ||
    url.startsWith("http://") ||
    url.startsWith("https://")
  );
}

export function toShareableMediaItem(item: MediaItem): MediaItem {
  const previewUrl = isShareableMediaUrl(item.previewUrl)
    ? item.previewUrl
    : "";
  const { lastError: _lastError, ...shared } = item;
  return {
    ...shared,
    previewUrl,
    thumbnailUrl: isShareableMediaUrl(item.thumbnailUrl)
      ? item.thumbnailUrl
      : undefined,
    // Peers only see the shareable URL, so a stripped blob: URL means the
    // bytes are not available to them yet.
    availability: previewUrl ? "ready" : "offline",
  };
}

export function buildFallbackMediaItem(
  ref: ServerMediaRef,
  palette: Palette,
): MediaItem {
  const kind = inferMediaKind(ref.name);
  return {
    id: ref.id,
    name: ref.name,
    kind,
    durationSeconds: 0,
    hasAudio: kind === "audio",
    hasVideo: kind === "video",
    color: palette.color,
    accent: palette.accent,
    previewUrl: ref.exists && isShareableMediaUrl(ref.url) ? ref.url : "",
    sourcePath: ref.path,
    availability: ref.exists && ref.url ? "hydrating" : "offline",
  };
}
