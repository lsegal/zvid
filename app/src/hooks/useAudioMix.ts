import { useCallback, useEffect, useMemo, useState } from "react";
import { logClient } from "../app/util.ts";
import type { AudioMix } from "../audio-mix/resolve.ts";
import {
  audioMixPeaksKey,
  getAudioMixContributions,
  getAudioMixOrigin,
} from "../audio-mix-clips.ts";
import { describeAudioMix } from "../audio-mix-peaks.ts";
import type { MixPeaksSource } from "../audio-mix-peaks.worker.ts";
import { mixWaveformPeaksInBackground } from "../audio-mix-peaks-loader.ts";
import type { MediaItem } from "../media";
import { loadWaveformPeaks } from "../waveform-loader";
import type { WaveformPeaks } from "../waveform-peaks";

// Recomputing waits for edits to settle, so dragging a clip or a Gain fader
// does not re-mix on every frame.
const MIX_DEBOUNCE_MS = 150;

export type AudioMixInputs = {
  // The resolved mix the preview plays.
  mix: AudioMix;
  mediaItemsById: ReadonlyMap<string, MediaItem>;
  // Resolves the mix again.
  refresh: () => void;
};

type MixState = {
  contributions: readonly AudioMixContribution[];
  mediaItemsById: ReadonlyMap<string, MediaItem>;
  peaks: WaveformPeaks | null;
};

// The Audio row's read-only waveform: the peaks of the resolved mix, rebuilt
// when its clips, their timing or their Gain change, or on Refresh. Edits to
// clips without audio, and to MIDI clips, leave it alone (see
// audioMixPeaksKey). It is mixed in a worker, after edits settle, so knob
// drags never wait on it.
export function useAudioMix({
  mix: audioMix,
  mediaItemsById: allMediaItemsById,
  refresh: refreshAudioMix,
}: AudioMixInputs) {
  const [mix, setMix] = useState<MixState | null>(null);
  const [refreshes, setRefreshes] = useState(0);
  const key = `${refreshes}:${audioMixPeaksKey(audioMix, allMediaItemsById)}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: key holds everything the peaks read from the mix and its media
  const { contributions, mediaItemsById } = useMemo(
    () => ({
      contributions: getAudioMixContributions(audioMix),
      mediaItemsById: allMediaItemsById,
    }),
    [key],
  );
  const refresh = useCallback(() => {
    setRefreshes((count) => count + 1);
    refreshAudioMix();
  }, [refreshAudioMix]);

  useEffect(() => {
    let canceled = false;
    const timer = setTimeout(() => {
      void Promise.all(
        contributions.map(async (contribution) => {
          const media = mediaItemsById.get(contribution.mediaId);
          if (media?.availability !== "ready" || !media.previewUrl) {
            return null;
          }
          try {
            const result = await loadWaveformPeaks(media.id, media.previewUrl);
            return result.status === "ready"
              ? { ...contribution, peaks: result.peaks }
              : null;
          } catch (error) {
            logClient("waveform:decode:error", {
              mediaId: media.id,
              message: error instanceof Error ? error.message : String(error),
            });
            return null;
          }
        }),
      )
        .then((clips) => {
          if (canceled) {
            return null;
          }
          const loaded: MixPeaksSource[] = [];
          for (const clip of clips) {
            if (clip) {
              loaded.push(clip);
            }
          }
          return mixWaveformPeaksInBackground(loaded);
        })
        .then(
          (peaks) => {
            if (!canceled) {
              setMix({ contributions, mediaItemsById, peaks });
            }
          },
          (error: unknown) => {
            logClient("audio-mix:peaks:error", {
              message: error instanceof Error ? error.message : String(error),
            });
            if (!canceled) {
              setMix({ contributions, mediaItemsById, peaks: null });
            }
          },
        );
    }, MIX_DEBOUNCE_MS);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [contributions, mediaItemsById]);

  const current =
    mix &&
    mix.contributions === contributions &&
    mix.mediaItemsById === mediaItemsById
      ? mix
      : null;
  // MIDI clips are not drawn but still count as mixed clips.
  return {
    summary: describeAudioMix(
      getAudioMixOrigin(audioMix),
      audioMix.clips.length,
    ),
    // Until the first mix of these inputs is ready, the last one stays up
    // under the skeleton.
    peaks: current ? current.peaks : (mix?.peaks ?? null),
    computing: contributions.length > 0 && !current,
    durationSeconds: Math.max(
      0,
      ...audioMix.clips.map(
        (clip) => clip.startSeconds + Math.max(0, clip.durationSeconds),
      ),
    ),
    refresh,
  };
}
