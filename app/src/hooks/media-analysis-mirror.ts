// A hidden copy of a media element, for analysis only: it loads the same
// media and follows the element's play, pause, seeks and rate, and a meter
// tap listens to it through Web Audio. It is for browsers that can't
// capture a media element's audio (WebKit, Firefox): routing the visible
// element itself into Web Audio would take over its output, and WebKit
// freezes a routed element for about 0.3 s after each play or seek. Only
// the copy is routed, and it is never connected to the speakers.

import { isWebKit } from "../audio-mix/preview-graph.ts";
import { isWebMMedia, type MixMediaItem } from "../audio-mix/preview-player.ts";

// The longest media WebKit follows from a decoded copy of its audio (see
// MediaAnalysisDecodedFollower), bounding the memory decoding takes: five
// minutes of 48 kHz stereo decodes to about 115 MB.
export const MAX_DECODED_ANALYSIS_SECONDS = 300;

// How the pane follows `media`'s audio where the browser can't capture its
// player: through a hidden routed copy of the player, through a decoded
// copy of its audio, or not at all, for media without audio. WebKit routes
// WebM silently (#1113) and nothing from 8 kHz media, so there media short
// enough is decoded instead, and longer media is mirrored unless it's WebM.
// Longer 8 kHz media stays silent in WebKit.
export type MediaAnalysisFallback = "mirror" | "decode" | null;

export function mediaAnalysisFallback(
  media:
    | (MixMediaItem & { hasAudio: boolean; durationSeconds: number })
    | undefined,
  webKit = isWebKit(),
): MediaAnalysisFallback {
  if (!media?.hasAudio) {
    return null;
  }
  if (!webKit) {
    return "mirror";
  }
  if (
    media.durationSeconds > 0 &&
    media.durationSeconds <= MAX_DECODED_ANALYSIS_SECONDS
  ) {
    return "decode";
  }
  return isWebMMedia(media) ? null : "mirror";
}

// How far the copy may drift from the element before it seeks to catch up.
// More than the 0.3 s WebKit freezes a routed element after a seek, so
// catching up never sets off another catch-up.
export const MIRROR_MAX_DRIFT_SECONDS = 1;

// The parts of a media element the mirror reads and drives, so tests can
// stand one in.
export type MirroredElement = Pick<
  HTMLMediaElement,
  | "currentSrc"
  | "currentTime"
  | "paused"
  | "seeking"
  | "playbackRate"
  | "crossOrigin"
  | "addEventListener"
  | "removeEventListener"
>;

// The hidden copy the mirror drives.
export type MirrorCopy = Pick<
  HTMLMediaElement,
  | "src"
  | "currentTime"
  | "paused"
  | "seeking"
  | "playbackRate"
  | "crossOrigin"
  | "preload"
  | "play"
  | "pause"
  | "load"
  | "removeAttribute"
>;

const FOLLOWED_EVENTS = [
  "play",
  "pause",
  "seeking",
  "ratechange",
  "timeupdate",
  "loadstart",
] as const;

export class MediaAnalysisMirror {
  readonly copy: MirrorCopy;
  private readonly element: MirroredElement;
  private readonly follow = (event: Event) => this.sync(event.type);

  constructor(element: MirroredElement, copy: MirrorCopy) {
    this.element = element;
    this.copy = copy;
    copy.preload = "auto";
    copy.crossOrigin = element.crossOrigin;
    if (element.currentSrc) {
      copy.src = element.currentSrc;
    }
    for (const type of FOLLOWED_EVENTS) {
      element.addEventListener(type, this.follow);
    }
    this.sync("seeking");
  }

  // Brings the copy in line with the element after one of its events.
  private sync(type: string) {
    const { element, copy } = this;
    if (
      type === "loadstart" &&
      element.currentSrc &&
      element.currentSrc !== copy.src
    ) {
      copy.src = element.currentSrc;
    }
    copy.playbackRate = element.playbackRate;
    const drift = Math.abs(copy.currentTime - element.currentTime);
    if (
      type === "seeking" ||
      type === "loadstart" ||
      (!copy.seeking && drift > MIRROR_MAX_DRIFT_SECONDS)
    ) {
      copy.currentTime = element.currentTime;
    }
    if (element.paused) {
      if (!copy.paused) {
        copy.pause();
      }
    } else if (copy.paused) {
      // Retried at the next event if the browser refuses it for now.
      copy.play().catch(() => {});
    }
  }

  dispose() {
    for (const type of FOLLOWED_EVENTS) {
      this.element.removeEventListener(type, this.follow);
    }
    this.copy.pause();
    this.copy.removeAttribute("src");
    this.copy.load();
  }
}
