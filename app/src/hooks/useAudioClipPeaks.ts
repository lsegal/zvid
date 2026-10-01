import { useEffect, useState } from "react";
import { logClient } from "../app/util.ts";
import type { ClipMediaState } from "../clip-media-state";
import type { MediaItem } from "../media";
import { loadWaveformPeaks } from "../waveform-loader";
import type { WaveformPeaks } from "../waveform-peaks";

export type AudioClipPeaks =
  // Not an audio-only clip, or its peaks could not be decoded: the clip
  // keeps the plain card.
  | { status: "none" }
  | { status: "loading" }
  | { status: "ready"; peaks: WaveformPeaks };

// The waveform peaks of a clip whose media is online and has no video. Peaks
// are decoded once per media and cached, so every clip of the same media
// shares them.
export function useAudioClipPeaks(
  media: MediaItem | undefined,
  mediaState: ClipMediaState,
): AudioClipPeaks {
  const mediaId =
    media && !media.hasVideo && mediaState === "online" ? media.id : "";
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
