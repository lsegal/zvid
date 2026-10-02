import { useEffect, useState } from "react";
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
  // Resolves the mix again, which hands this hook new contributions.
  refresh: () => void;
};

type MixState = {
  contributions: readonly AudioMixContribution[];
  mediaItemsById: ReadonlyMap<string, MediaItem>;
  peaks: WaveformPeaks | null;
};

// The Audio row's read-only waveform: the peaks of the resolved mix, rebuilt
// when its clips, their timing or their Gain change, or on Refresh.
export function useAudioMix({
  origin,
  contributions,
  mediaItemsById,
  refresh,
}: AudioMixInputs) {
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
      ).then((clips) => {
        if (!canceled) {
          const loaded: MixPeaksClip[] = [];
          for (const clip of clips) {
            if (clip) {
              loaded.push(clip);
            }
          }
          setMix({
            contributions,
            mediaItemsById,
            peaks: mixWaveformPeaks(loaded),
          });
        }
      });
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
