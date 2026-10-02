import { useCallback, useEffect, useState } from "react";
import { logClient } from "../app/util.ts";
import {
  type AudioMixOrigin,
  describeAudioMix,
  type MixPeaksClip,
  mixWaveformPeaks,
} from "../audio-mix-peaks.ts";
import type { MediaItem } from "../media";
import { loadWaveformPeaks } from "../waveform-loader";
import type { WaveformPeaks } from "../waveform-peaks";

// Recomputing waits for edits to settle, so dragging a clip or a Gain fader
// does not re-mix on every frame.
const MIX_DEBOUNCE_MS = 150;

// A clip that renders audio, as the resolved mix plays it.
export type AudioMixContribution = Omit<MixPeaksClip, "peaks"> & {
  mediaId: string;
};

export type AudioMixInputs = {
  origin: AudioMixOrigin;
  contributions: readonly AudioMixContribution[];
  mediaItemsById: ReadonlyMap<string, MediaItem>;
};

type MixState = {
  inputs: AudioMixInputs;
  refreshCount: number;
  peaks: WaveformPeaks | null;
};

// The Audio row's read-only waveform: the peaks of the resolved mix, rebuilt
// when its clips, their timing or their Gain change, or on Refresh.
export function useAudioMix(inputs: AudioMixInputs) {
  const { contributions, mediaItemsById, origin } = inputs;
  const [refreshCount, setRefreshCount] = useState(0);
  const [mix, setMix] = useState<MixState | null>(null);

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
            const result = await loadWaveformPeaks(
              media.id,
              media.previewUrl,
            );
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
      ).then((clips) => {
        if (!canceled) {
          setMix({
            inputs: { contributions, mediaItemsById, origin },
            refreshCount,
            peaks: mixWaveformPeaks(
              clips.filter((clip): clip is MixPeaksClip => clip !== null),
            ),
          });
        }
      });
    }, MIX_DEBOUNCE_MS);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [contributions, mediaItemsById, origin, refreshCount]);

  const refresh = useCallback(() => {
    setRefreshCount((count) => count + 1);
  }, []);

  const current =
    mix &&
    mix.inputs.contributions === contributions &&
    mix.inputs.mediaItemsById === mediaItemsById &&
    mix.refreshCount === refreshCount
      ? mix
      : null;
  return {
    summary: describeAudioMix(origin, contributions.length),
    // Until the first mix of these inputs is ready, the last one stays up
    // under the skeleton.
    peaks: current ? current.peaks : (mix?.peaks ?? null),
    computing: contributions.length > 0 && !current,
    durationSeconds: Math.max(
      0,
      ...contributions.map((contribution) => contribution.endSeconds),
    ),
    refresh,
  };
}
