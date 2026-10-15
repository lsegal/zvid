// The Audio row draws the resolved mix (see audio-mix/resolve.ts): each
// clip's media mapped onto song time the way the mix plays it, at its Gain
// and the Global Gain.
//
// A MIDI clip's media is its performance, its notes through its instrument,
// which is rendered for its peaks (see synth-waveform-loader.ts).
import type { AudioMix, AudioMixClip } from "./audio-mix/resolve.ts";
import type { SynthClip } from "./audio-mix/synth.ts";
import type { AudioMixOrigin, MixPeaksClip } from "./audio-mix-peaks.ts";
import { loopMediaTime, warpSourceTime } from "./clip-warp.ts";
import type { MediaItem } from "./media.ts";
import type { WaveformPeaks } from "./waveform-peaks.ts";

// Where a clip reads its media from over song time. It is plain data, so
// it can be posted to the mixing worker (see audio-mix-peaks.worker.ts).
export type AudioMixTiming = Pick<
  AudioMixClip,
  | "sourceOffsetSeconds"
  | "sourceWindowStartSeconds"
  | "sourceWindowEndSeconds"
  | "mediaDurationSeconds"
  | "warp"
> & { bpm: number };

// A clip the Audio row draws, as the resolved mix plays it.
export type AudioMixContribution = Omit<
  MixPeaksClip,
  "peaks" | "sourceSecondsAt"
> & {
  mediaId: string;
  timing: AudioMixTiming;
  // A MIDI clip's performance, whose rendered audio is its media.
  synth?: SynthClip;
};

export function getAudioMixOrigin(mix: AudioMix): AudioMixOrigin {
  return mix.fromSourceTracks ? "source-tracks" : "layers";
}

export function getAudioMixContributions(
  mix: AudioMix,
): AudioMixContribution[] {
  return mix.clips.map((clip) => ({
    mediaId: clip.mediaId,
    ...(clip.synth ? { synth: clip.synth } : {}),
    startSeconds: clip.startSeconds,
    endSeconds: clip.startSeconds + Math.max(0, clip.durationSeconds),
    amplitude: clip.amplitude * mix.masterAmplitude,
    timing: {
      sourceOffsetSeconds: clip.sourceOffsetSeconds,
      sourceWindowStartSeconds: clip.sourceWindowStartSeconds,
      sourceWindowEndSeconds: clip.sourceWindowEndSeconds,
      mediaDurationSeconds: clip.mediaDurationSeconds,
      warp: clip.warp,
      bpm: mix.bpm,
    },
  }));
}

// A contribution with its media's peaks, ready to mix.
export function toMixPeaksClip(
  { timing, ...contribution }: AudioMixContribution,
  peaks: WaveformPeaks,
): MixPeaksClip {
  return {
    startSeconds: contribution.startSeconds,
    endSeconds: contribution.endSeconds,
    amplitude: contribution.amplitude,
    peaks,
    // The source time at song second `t` is `t + sourceOffsetSeconds`,
    // inside the source window, through the clip's warp markers, looped
    // back to the media's start past its end.
    sourceSecondsAt: (songSeconds) => {
      const linear = songSeconds + timing.sourceOffsetSeconds;
      if (
        linear < timing.sourceWindowStartSeconds ||
        linear > timing.sourceWindowEndSeconds
      ) {
        return null;
      }
      return loopMediaTime(
        timing.warp
          ? warpSourceTime(timing.warp, linear, timing.bpm).seconds
          : linear,
        timing.mediaDurationSeconds ?? 0,
      );
    },
  };
}

// Everything the Audio row's waveform reads from the mix and its media. The
// mix holds only clips whose media has audio, so editing a clip without
// audio (video-only media, fill, text or FX clips) leaves the key as it was
// and the waveform is not rebuilt. An edit that adds a clip to the mix or
// takes one out of it, such as re-pointing a clip between audio and
// video-only media, changes the key. A MIDI clip's media id names its
// performance, so editing its notes, its instrument or the tempo changes it.
export function audioMixPeaksKey(
  mix: AudioMix,
  mediaItemsById: ReadonlyMap<string, MediaItem>,
) {
  const media = new Map<string, unknown>();
  const clips = mix.clips.map((clip) => {
    if (!clip.synth) {
      const item = mediaItemsById.get(clip.mediaId);
      media.set(clip.mediaId, [item?.availability, item?.previewUrl]);
    }
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
