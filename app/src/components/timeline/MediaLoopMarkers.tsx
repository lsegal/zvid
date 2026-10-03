import {
  getMediaLoopMarkersPx,
  getVisibleClipSlice,
  type WaveformSourceRange,
} from "../../waveform-range.ts";
import "./media-loop-markers.css";

type MediaLoopMarkersProps = {
  range: WaveformSourceRange;
  // Where the clip sits on the timeline and what of it is visible, in
  // pixels, so only the visible part of a long clip is marked.
  clipLeftPx: number;
  clipWidthPx: number;
  visibleStartPx: number;
  visibleWidthPx: number;
};

// A thin line at each point in a clip where its media runs out and loops
// back to its start.
export function MediaLoopMarkers({
  range,
  clipLeftPx,
  clipWidthPx,
  visibleStartPx,
  visibleWidthPx,
}: MediaLoopMarkersProps) {
  const slice = getVisibleClipSlice(
    clipLeftPx,
    clipWidthPx,
    visibleStartPx,
    visibleWidthPx,
  );
  const markers = slice
    ? getMediaLoopMarkersPx(range, slice.startPx, slice.startPx + slice.widthPx)
    : [];
  return markers.length ? (
    <span aria-hidden="true" className="media-loop-markers">
      {markers.map((leftPx) => (
        <span
          key={leftPx}
          className="media-loop-markers__marker"
          style={{ left: leftPx }}
        />
      ))}
    </span>
  ) : null;
}
