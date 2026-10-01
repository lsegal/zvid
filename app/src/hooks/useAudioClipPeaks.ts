import { useEffect, useState } from "react";
import { logClient } from "../app/util.ts";
import type { ClipWaveformKind } from "../clip-waveform.ts";
import type { MediaItem } from "../media";
import { loadWaveformPeaks } from "../waveform-loader";
import type { WaveformPeaks } from "../waveform-peaks";

export type AudioClipPeaks =
  // The clip draws no waveform, or its peaks could not be decoded: the clip
  // keeps the plain card, or just its frames.
  | { status: "none" }
  | { status: "loading" }
  | { status: "ready"; peaks: WaveformPeaks };

// The waveform peaks of a clip that draws a waveform, of either kind. Peaks
// are decoded once per media and cached, so every clip of the same media
// shares them.
export function useAudioClipPeaks(
  media: MediaItem | undefined,
  kind: ClipWaveformKind,
): AudioClipPeaks {
  const mediaId = media && kind !== "none" ? media.id : "";
  const url =
    mediaId && media?.availability === "ready" ? media.previewUrl : "";
  const key = mediaId && url ? `${mediaId}\n${url}` : "";
  const [loaded, setLoaded] = useState<{
    key: string;
    peaks: WaveformPeaks | null;
  } | null>(null);

  useEffect(() => {
    if (!mediaId || !url) {
      return;
    }

    const key = `${mediaId}\n${url}`;
    let canceled = false;
    loadWaveformPeaks(mediaId, url).then(
      (result) => {
        if (!canceled) {
          setLoaded({
            key,
            peaks: result.status === "ready" ? result.peaks : null,
          });
        }
      },
      (error: unknown) => {
        logClient("waveform:decode:error", {
          mediaId,
          message: error instanceof Error ? error.message : String(error),
        });
        if (!canceled) {
          setLoaded({ key, peaks: null });
        }
      },
    );
    return () => {
      canceled = true;
    };
  }, [mediaId, url]);

  if (!key) {
    return { status: "none" };
  }
  if (loaded?.key !== key) {
    return { status: "loading" };
  }
  return loaded.peaks
    ? { status: "ready", peaks: loaded.peaks }
    : { status: "none" };
}
