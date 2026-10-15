import { createPortal } from "react-dom";
import type { MarqueeRect } from "../../hooks/useMarqueeSelection.ts";
import "./marquee-box.css";

// The accent box a marquee selection draws over the timeline, while one is
// drawn (see useMarqueeSelection).
export function MarqueeBox({ rect }: { rect: MarqueeRect | null }) {
  if (!rect) {
    return null;
  }
  return createPortal(
    <div
      aria-hidden="true"
      className="marquee-box"
      data-testid="marquee-box"
      style={rect}
    />,
    document.body,
  );
}
