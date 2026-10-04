// The Audio row draws the resolved mix (see audio-mix/resolve.ts): each
// clip's media mapped onto song time the way the mix plays it, at its Gain
// and the Global Gain.
import type { AudioMix } from "./audio-mix/resolve.ts";
import type { AudioMixOrigin } from "./audio-mix-peaks.ts";
import { loopMediaTime, warpSourceTime } from "./clip-warp.ts";
import type { AudioMixContribution } from "./hooks/useAudioMix.ts";
import type { MediaItem } from "./media.ts";

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
    // inside the source window, through the clip's warp markers, looped
    // back to the media's start past its end.
    sourceSecondsAt: (songSeconds) => {
      const linear = songSeconds + clip.sourceOffsetSeconds;
      if (
        linear < clip.sourceWindowStartSeconds ||
        linear > clip.sourceWindowEndSeconds
      ) {
        return null;
      }
      return loopMediaTime(
        clip.warp ? warpSourceTime(clip.warp, linear, mix.bpm).seconds : linear,
        clip.mediaDurationSeconds ?? 0,
      );
    },
  }));
}

// Everything the Audio row's waveform reads from the mix and its media. The
// mix holds only clips whose media has audio, so editing a clip without
// audio (video-only media, fill, text or FX clips) leaves the key as it was
// and the waveform is not rebuilt. An edit that adds a clip to the mix or
// takes one out of it, such as re-pointing a clip between audio and
// video-only media, changes the key.
export function audioMixPeaksKey(
  mix: AudioMix,
  mediaItemsById: ReadonlyMap<string, MediaItem>,
) {
  const media = new Map<string, unknown>();
  const clips = mix.clips.map((clip) => {
    const item = mediaItemsById.get(clip.mediaId);
    media.set(clip.mediaId, [item?.availability, item?.previewUrl]);
    return [
      clip.mediaId,
      clip.startSeconds,
      clip.durationSeconds,
      clip.sourceOffsetSeconds,
      clip.sourceWindowStartSeconds,
      clip.sourceWindowEndSeconds,
      clip.mediaDurationSeconds ?? 0,
      clip.amplitude * mix.masterAmplitude,
      clip.warp ?? null,
    ];
  });
  return JSON.stringify([
    getAudioMixOrigin(mix),
    clips.some((clip) => clip[8]) ? mix.bpm : null,
    clips,
    [...media],
  ]);
}
