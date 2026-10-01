import type { AudioClipPeaks } from "../../hooks/useAudioClipPeaks.ts";
import { WaveformCanvas } from "../../WaveformCanvas";
import {
  getVisibleClipSlice,
  type WaveformSourceRange,
} from "../../waveform-range.ts";
import { MediaSyncSkeleton } from "../MediaSyncSkeleton";

type ClipWaveformProps = {
  peaks: AudioClipPeaks;
  range: WaveformSourceRange;
  className: string;
  // Where the clip sits on the timeline and what of it is visible, in
  // pixels, so only the visible part of a long clip is drawn.
  clipLeftPx: number;
  clipWidthPx: number;
  visibleStartPx: number;
  visibleWidthPx: number;
};

// An audio-only clip's waveform, drawn like the Audio lane's, or a skeleton
// while its peaks decode.
export function ClipWaveform({
  peaks,
  range,
  className,
  clipLeftPx,
  clipWidthPx,
  visibleStartPx,
  visibleWidthPx,
}: ClipWaveformProps) {
  if (peaks.status === "loading") {
    return <MediaSyncSkeleton style={{ right: 0 }} variant="waveform" />;
  }
  if (peaks.status !== "ready") {
    return null;
  }

  const slice = getVisibleClipSlice(
    clipLeftPx,
    clipWidthPx,
    visibleStartPx,
    visibleWidthPx,
  );
  return slice ? (
    <WaveformCanvas
      className={className}
      peaks={peaks.peaks}
      range={range}
      startPx={slice.startPx}
      widthPx={slice.widthPx}
    />
  ) : null;
}
