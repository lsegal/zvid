import {
  type ArrangementClip,
  type MediaItem,
  quartersToSeconds,
} from "./composition-active-clips.ts";
import { releaseMediaElement } from "./media-element.ts";

// The preview keeps a video element only for media whose clips are near the
// playhead: it is made, loading only its metadata, this long before its clip
// starts, buffers in full from this long before, and is released this long
// after its clip ends.
export const MEDIA_LOOKAHEAD_SECONDS = 5;
export const MEDIA_PRELOAD_SECONDS = 1.5;
export const MEDIA_RELEASE_SECONDS = 3;

export type MediaPreload = "metadata" | "auto";

// The video media the preview needs an element for at `playheadSeconds`, and
// how much of each to load. Audio-only media plays through the mixer, so it
// never needs one; fill, text and FX clips draw no media.
export function mediaWindowAt(
  clips: readonly ArrangementClip[],
  mediaById: ReadonlyMap<string, MediaItem>,
  playheadSeconds: number,
  bpm: number,
) {
  const window = new Map<string, MediaPreload>();
  for (const clip of clips) {
    if (clip.kind === "fill" || clip.kind === "text" || clip.kind === "fx") {
      continue;
    }
    const media = clip.mediaId ? mediaById.get(clip.mediaId) : undefined;
    if (media?.kind !== "video" || !media.previewUrl) {
      continue;
    }
    const start = quartersToSeconds(clip.startQ, bpm);
    const end = start + clip.durationSeconds;
    if (
      playheadSeconds < start - MEDIA_LOOKAHEAD_SECONDS ||
      playheadSeconds >= end + MEDIA_RELEASE_SECONDS
    ) {
      continue;
    }
    const needed =
      playheadSeconds >= start - MEDIA_PRELOAD_SECONDS && playheadSeconds < end;
    if (needed || !window.has(media.id)) {
      window.set(media.id, needed ? "auto" : "metadata");
    }
  }
  return window;
}

// The preview's media elements by source key (see ActiveClip.sourceKey).
// Their audio plays through the mixer, so they are muted and only drawn.
export class MediaElementPool {
  readonly elements = new Map<string, HTMLMediaElement>();
  private mediaIdBySourceKey = new Map<string, string>();

  mediaIdOf(sourceKey: string) {
    return this.mediaIdBySourceKey.get(sourceKey);
  }

  // Makes the element for `sourceKey`, or points it at `item`'s current
  // source, loading as much as `preload` asks; it never loads less once it
  // has loaded more. Returns whether it made one.
  ensure(sourceKey: string, item: MediaItem, preload: MediaPreload) {
    let element = this.elements.get(sourceKey);
    const created = !element;
    if (!element) {
      element = document.createElement("video");
      element.crossOrigin = "anonymous";
      element.playsInline = true;
      element.muted = true;
      element.preload = preload;
      this.elements.set(sourceKey, element);
      this.mediaIdBySourceKey.set(sourceKey, item.id);
    } else if (preload === "auto" && element.preload !== "auto") {
      element.preload = "auto";
    }
    if (element.getAttribute("src") !== item.previewUrl) {
      element.src = item.previewUrl;
    }
    return created;
  }

  // Keeps elements only for the media in `window` (see mediaWindowAt),
  // making each one's first element. Returns whether any were made or
  // released.
  sync(
    window: ReadonlyMap<string, MediaPreload>,
    mediaById: ReadonlyMap<string, MediaItem>,
  ) {
    let changed = false;
    for (const sourceKey of [...this.elements.keys()]) {
      const mediaId = this.mediaIdBySourceKey.get(sourceKey) ?? "";
      const item = mediaById.get(mediaId);
      if (item && window.has(mediaId)) {
        this.ensure(sourceKey, item, "metadata");
      } else {
        this.release(sourceKey);
        changed = true;
      }
    }
    for (const [mediaId, preload] of window) {
      const item = mediaById.get(mediaId);
      if (item && this.ensure(mediaId, item, preload)) {
        changed = true;
      }
    }
    return changed;
  }

  clear() {
    for (const sourceKey of [...this.elements.keys()]) {
      this.release(sourceKey);
    }
  }

  private release(sourceKey: string) {
    const element = this.elements.get(sourceKey);
    if (element) {
      releaseMediaElement(element);
    }
    this.elements.delete(sourceKey);
    this.mediaIdBySourceKey.delete(sourceKey);
  }
}
