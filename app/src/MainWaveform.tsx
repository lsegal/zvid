import { WaveformCanvas } from "./WaveformCanvas";
import type { WaveformPeaks } from "./waveform-peaks";

type MainWaveformProps = {
  peaks: WaveformPeaks;
  bpm: number;
  quarterPx: number;
  visibleStartPx: number;
  visibleWidthPx: number;
};

// Draws only the visible slice of the lane so the canvas stays small at any
// zoom level; x positions use the same quarter scale as the clip lanes.
export function MainWaveform({
  peaks,
  bpm,
  quarterPx,
  visibleStartPx,
  visibleWidthPx,
}: MainWaveformProps) {
  return (
    <WaveformCanvas
      className="waveform__canvas"
      peaks={peaks}
      range={{ startSeconds: 0, secondsPerPx: 60 / (bpm * quarterPx) }}
      startPx={visibleStartPx}
      widthPx={visibleWidthPx}
    />
  );
}
