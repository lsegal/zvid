// The clips the Audio row draws, as the resolved mix plays them: every layer
// clip with audio when there is any, else every source clip with audio, each
// at its own Gain.
import { quartersToSeconds } from "./app/timeline-math.ts";
import type { ArrangementClip, SourceSpan } from "./app/types.ts";
import type { AudioMixOrigin } from "./audio-mix-peaks.ts";
import { isGeneratedClip } from "./clip-media-state.ts";
import { type ClipWarp, warpSourceTime } from "./clip-warp.ts";
import { clipEffectTrackId, sourceClipEffectTrackId } from "./fx-stack.ts";
import type { AudioMixContribution } from "./hooks/useAudioMix.ts";
import type { MediaItem } from "./media.ts";

// Plays linear source seconds through the clip's warp, and nothing outside
// its source window.
function mapSourceSeconds(
  linearAt: (songSeconds: number) => number,
  windowStartSeconds: number,
  windowEndSeconds: number,
  warp: ClipWarp | undefined,
  bpm: number,
) {
  return (songSeconds: number) => {
    const linear = linearAt(songSeconds);
    if (linear < windowStartSeconds || linear > windowEndSeconds) {
      return null;
    }
    return warp ? warpSourceTime(warp, linear, bpm).seconds : linear;
  };
}

export function resolveAudioMixContributions({
  clips,
  sourceSpans,
  mediaItemsById,
  bpm,
  amplitudeOf,
}: {
  clips: readonly ArrangementClip[];
  sourceSpans: readonly SourceSpan[];
  mediaItemsById: ReadonlyMap<string, MediaItem>;
  bpm: number;
  // The linear gain of an effect stack, by its track id; 0 without Gain.
  amplitudeOf: (effectTrackId: string) => number;
}): { origin: AudioMixOrigin; contributions: AudioMixContribution[] } {
  const hasAudio = (clip: { mediaId?: string }) =>
    clip.mediaId !== undefined &&
    mediaItemsById.get(clip.mediaId)?.hasAudio === true;

  const layerClips = clips.filter(
    (clip) => !isGeneratedClip(clip) && hasAudio(clip),
  );
  if (layerClips.length) {
    return {
      origin: "layers",
      contributions: layerClips.map((clip) => {
        const startSeconds = quartersToSeconds(clip.startQ, bpm);
        return {
          mediaId: clip.mediaId as string,
          startSeconds,
          endSeconds: startSeconds + clip.durationSeconds,
          amplitude: amplitudeOf(clipEffectTrackId(clip.id)),
          sourceSecondsAt: mapSourceSeconds(
            (songSeconds) => songSeconds + clip.sourceOffsetSeconds,
            clip.sourceWindowStartSeconds,
            clip.sourceWindowEndSeconds,
            clip.warp,
            bpm,
          ),
        };
      }),
    };
  }

  return {
    origin: "source-tracks",
    contributions: sourceSpans.filter(hasAudio).map((span) => {
      const startSeconds = quartersToSeconds(span.startQ, bpm);
      const duration = Math.max(0, span.durationSeconds);
      return {
        mediaId: span.mediaId as string,
        startSeconds,
        endSeconds: startSeconds + duration,
        amplitude: amplitudeOf(sourceClipEffectTrackId(span.id)),
        sourceSecondsAt: mapSourceSeconds(
          (songSeconds) =>
            span.trimStartSeconds + (songSeconds - startSeconds),
          span.trimStartSeconds,
          span.trimStartSeconds + duration,
          span.warp,
          bpm,
        ),
      };
    }),
  };
}
