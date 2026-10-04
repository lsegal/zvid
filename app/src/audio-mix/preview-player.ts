// The media elements the preview mixer plays its clips from. A video
// clip's element is a <video> the compositor also draws (see
// PreviewAudioMixer.videoElementFor), so the clip's media is fetched and
// demuxed once. Routed into Web Audio, the element sounds only through the
// mix, so it is never muted: Chromium feeds a muted element's silence into
// its MediaElementAudioSourceNode.
import { clamp } from "../app/util.ts";
import type { ClipWarp } from "../clip-warp.ts";
import type { AudioMixClip } from "./resolve.ts";

// A media element routed into Web Audio. Voices of the same media trade
// players, so its source moves to whichever voice's gain it plays for.
export type Player = {
  element: HTMLMediaElement;
  source: MediaElementAudioSourceNode;
  // Whether it is a <video> the compositor may draw.
  video: boolean;
  // The audio clock time its seek during playback was made, until it lands.
  seekStartedAt: number | null;
};

// HTMLMediaElement.HAVE_FUTURE_DATA: an element with this much can play.
export const HAVE_FUTURE_DATA = 3;

// The most a seek during playback aims ahead of the playhead to make up for
// how long seeks take to land.
export const MAX_SEEK_LEAD_SECONDS = 0.5;

// Whether `element` can play from where it is without waiting.
export function isReady(element: HTMLMediaElement) {
  return element.readyState >= HAVE_FUTURE_DATA && !element.seeking;
}

// A player for `url`, calling `onSeekLanded` with how long each seek during
// playback took to land, by the audio clock.
export function createPlayer(
  context: AudioContext,
  url: string,
  video: boolean,
  onSeekLanded: (seconds: number) => void,
): Player {
  const element = document.createElement(video ? "video" : "audio");
  element.crossOrigin = "anonymous";
  element.preload = "auto";
  if (element instanceof HTMLVideoElement) {
    element.playsInline = true;
  }
  element.src = url;
  // Routing through Web Audio is permanent; the element plays at full
  // volume into its voice's gain.
  const source = context.createMediaElementSource(element);
  const player: Player = { element, source, video, seekStartedAt: null };
  element.addEventListener("seeked", () => {
    if (player.seekStartedAt !== null) {
      onSeekLanded(
        clamp(
          context.currentTime - player.seekStartedAt,
          0,
          MAX_SEEK_LEAD_SECONDS,
        ),
      );
      player.seekStartedAt = null;
    }
  });
  return player;
}

// A clip the compositor draws, in the fields that place its media on the
// timeline.
export type DrawnClip = {
  mediaId?: string;
  startSeconds: number;
  durationSeconds: number;
  sourceOffsetSeconds: number;
  sourceWindowStartSeconds: number;
  sourceWindowEndSeconds: number;
  warp?: ClipWarp;
};

const PLACEMENT_EPSILON_SECONDS = 1e-6;

// Whether the mix clip `audio` plays its media just where the compositor
// draws `drawn`, so one element can serve both: preview and export resolve
// both from the same layer clip pieces or source spans.
export function playsLike(audio: AudioMixClip, drawn: DrawnClip) {
  const near = (left: number, right: number) =>
    Math.abs(left - right) < PLACEMENT_EPSILON_SECONDS;
  return (
    audio.mediaId === drawn.mediaId &&
    near(audio.startSeconds, drawn.startSeconds) &&
    near(audio.durationSeconds, drawn.durationSeconds) &&
    near(audio.sourceOffsetSeconds, drawn.sourceOffsetSeconds) &&
    near(audio.sourceWindowStartSeconds, drawn.sourceWindowStartSeconds) &&
    near(audio.sourceWindowEndSeconds, drawn.sourceWindowEndSeconds) &&
    (audio.warp === drawn.warp ||
      JSON.stringify(audio.warp) === JSON.stringify(drawn.warp))
  );
}
