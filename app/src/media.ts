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
  color: string;
  accent: string;
  waveform: number[];
  previewUrl: string;
  thumbnailUrl?: string;
  sourcePath?: string;
  availability: MediaAvailability;
};

export function createMediaId(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function buildFallbackWaveform(seed: string, points = 96) {
  let state = Array.from(seed).reduce(
    (total, character, index) => total + character.charCodeAt(0) * (index + 17),
    97,
  );
  return Array.from({ length: points }, (_, index) => {
    state = (state * 48271) % 2147483647;
    const phase = state / 2147483647;
    return Math.max(
      0.08,
      Math.min(
        1,
        Math.abs(Math.sin(index * 0.31 + phase * 5.2) * 0.72) + phase * 0.18,
      ),
    );
  });
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
  return {
    ...item,
    previewUrl: isShareableMediaUrl(item.previewUrl) ? item.previewUrl : "",
    thumbnailUrl: isShareableMediaUrl(item.thumbnailUrl)
      ? item.thumbnailUrl
      : undefined,
    availability: item.previewUrl ? "ready" : "offline",
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
    waveform: buildFallbackWaveform(ref.name),
    previewUrl: isShareableMediaUrl(ref.url) ? ref.url : "",
    sourcePath: ref.path,
    availability: ref.exists && ref.url ? "hydrating" : "offline",
  };
}
