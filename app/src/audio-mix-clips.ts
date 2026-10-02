// The Audio row draws the resolved mix (see audio-mix/resolve.ts): each
// clip's media mapped onto song time the way the mix plays it, at its Gain
// and the Global Gain.
import type { AudioMix } from "./audio-mix/resolve.ts";
import type { AudioMixOrigin } from "./audio-mix-peaks.ts";
import { warpSourceTime } from "./clip-warp.ts";
import type { AudioMixContribution } from "./hooks/useAudioMix.ts";

export function getAudioMixOrigin(mix: AudioMix): AudioMixOrigin {
  return mix.fromSourceTracks ? "source-tracks" : "layers";
}

export function getAudioMixContributions(
  mix: AudioMix,
): AudioMixContribution[] {
  return mix.clips.map((clip) => ({
    mediaId: clip.mediaId,
    startSeconds: clip.startSeconds,
    endSeconds: clip.startSeconds + Math.max(0, clip.durationSeconds),
    amplitude: clip.amplitude * mix.masterAmplitude,
    // The source time at song second `t` is `t + sourceOffsetSeconds`,
    // inside the source window, through the clip's warp markers.
    sourceSecondsAt: (songSeconds) => {
      const linear = songSeconds + clip.sourceOffsetSeconds;
      if (
        linear < clip.sourceWindowStartSeconds ||
        linear > clip.sourceWindowEndSeconds
      ) {
        return null;
      }
      return clip.warp
        ? warpSourceTime(clip.warp, linear, mix.bpm).seconds
        : linear;
    },
  }));
}
