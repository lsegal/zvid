import { useEffect, useRef, useState } from "react";
import { logClient } from "../app/util.ts";
import type { SourceSpanSynth } from "../audio-mix/resolve.ts";
import { sharedSynthWaveformLoader } from "../synth-waveform-loader.ts";
import type { WaveformPeaks } from "../waveform-peaks";
import type { AudioClipPeaks } from "./useAudioClipPeaks.ts";

// The waveform peaks of a MIDI clip's performance, rendered off the main
// thread once `enabled` (see synth-waveform-loader.ts), while it keeps its
// note thumbnail. They render again when its notes, instrument or tempo
// change, which changes its media id.
export function useSynthClipPeaks(
  performance: SourceSpanSynth | undefined,
  bpm: number,
  enabled: boolean,
): AudioClipPeaks {
  const mediaId = performance?.mediaId ?? "";
  // The synth the media id names; an equal one renders the same.
  const latest = useRef({ performance, bpm });
  latest.current = { performance, bpm };
  const [loaded, setLoaded] = useState<{
    mediaId: string;
    peaks: WaveformPeaks | null;
  } | null>(null);
  const isLoaded = loaded?.mediaId === mediaId;

  useEffect(() => {
    const { performance, bpm } = latest.current;
    if (!enabled || isLoaded || !performance || !mediaId) {
      return;
    }
    let canceled = false;
    const request = sharedSynthWaveformLoader().request(
      mediaId,
      performance.synth,
      bpm,
    );
    request.peaks.then(
      (result) => {
        if (!canceled) {
          setLoaded({
            mediaId,
            peaks: result.status === "ready" ? result.peaks : null,
          });
        }
      },
      (error: unknown) => {
        logClient("waveform:synth:error", {
          mediaId,
          message: error instanceof Error ? error.message : String(error),
        });
        if (!canceled) {
          setLoaded({ mediaId, peaks: null });
        }
      },
    );
    return () => {
      canceled = true;
      request.release();
    };
  }, [enabled, isLoaded, mediaId]);

  if (!mediaId) {
    return { status: "none" };
  }
  if (!isLoaded) {
    return { status: "loading" };
  }
  return loaded.peaks
    ? { status: "ready", peaks: loaded.peaks }
    : { status: "none" };
}
