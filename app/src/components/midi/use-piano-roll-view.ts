import { type RefObject, useLayoutEffect, useState } from "react";
import type { MidiNote } from "../../midi-clip.ts";
import type { MidiClipTimeline } from "../../midi-clip-timeline.ts";

// The keys' column, as in midi-devices.css.
const KEYS_PX = 34;

// The quarters the roll shows at the least: the clip's Length and every note,
// out to the next bar, and one more bar to drag the loop or the clip's end
// into.
function contentViewQ(notes: readonly MidiNote[], timeline: MidiClipTimeline) {
  const lastQ = notes.reduce(
    (end, note) => Math.max(end, note.start + note.length),
    timeline.length,
  );
  return Math.ceil(lastQ / 4) * 4 + 4;
}

// How many quarters the roll shows at `quarterPx`, and the grid's width at
// `fitQuarterPx`, the unzoomed quarter, which sizes the Notes region. The
// region keeps that size whatever the zoom (#1652): zooming in scrolls more
// of the grid out of view, and zooming out adds bars until the grid fills the
// scroller, as the main timeline does. A collapsed roll has no scroller.
export function usePianoRollView({
  scrollRef,
  collapsed,
  notes,
  timeline,
  quarterPx,
  fitQuarterPx,
}: {
  scrollRef: RefObject<HTMLElement | null>;
  collapsed: boolean;
  notes: readonly MidiNote[];
  timeline: MidiClipTimeline;
  quarterPx: number;
  fitQuarterPx: number;
}) {
  const [viewportWidth, setViewportWidth] = useState(0);
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || collapsed) {
      return;
    }
    const measure = () => setViewportWidth(scroller.clientWidth - KEYS_PX);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scrollRef, collapsed]);
  const contentQ = contentViewQ(notes, timeline);
  const fillQ = Math.ceil(viewportWidth / quarterPx / 4) * 4;
  return {
    viewQ: Math.max(contentQ, fillQ),
    fitWidth: contentQ * fitQuarterPx,
  };
}
