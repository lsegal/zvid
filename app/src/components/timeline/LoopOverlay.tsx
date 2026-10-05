import { type LoopRegion, loopRegionPx } from "../../app/loop-region.ts";
import "./loop-overlay.css";

// The loop region carried down the timeline from the ruler's loop brace: a
// faint yellow tint between dotted lines at its in and out markers, drawn
// behind the clips like a lane background. With no loop, nothing is drawn.
export function LoopOverlay({
  loopRegion,
  quarterPx,
  offsetPx,
  className,
}: {
  loopRegion: LoopRegion | null;
  quarterPx: number;
  offsetPx: number;
  className: string;
}) {
  if (!loopRegion) {
    return null;
  }
  const { startPx, endPx } = loopRegionPx(loopRegion, quarterPx);
  return (
    <div
      aria-hidden="true"
      className={`loop-overlay ${className}`}
      style={{ left: offsetPx + startPx, width: endPx - startPx }}
    >
      <div className="loop-overlay__line loop-overlay__line--start" />
      <div className="loop-overlay__line loop-overlay__line--end" />
    </div>
  );
}
