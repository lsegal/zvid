// Moving the layer selection.
import { stepSelectedLaneId } from "../fx-chain";
import { canEditTimeline } from "./guards.ts";
import type { Shortcut } from "./types.ts";

// Up and Down select the layer above or below, only while the timeline (or
// nothing) has focus and no clip is selected, so other panels keep their own
// arrow keys.
export const stepLayerShortcut: Shortcut = {
  id: "layers.step-selection",
  keys: ["ArrowUp", "ArrowDown"],
  when: canEditTimeline,
  run: (
    { fxLaneId, lanes, selectedClip, setSelectedLaneId, timelineScrollRef },
    event,
  ) => {
    const timelineScroll = timelineScrollRef.current;
    const activeElement = document.activeElement;
    if (
      selectedClip ||
      (activeElement &&
        activeElement !== document.body &&
        !timelineScroll?.contains(activeElement))
    ) {
      return;
    }

    const nextLaneId = stepSelectedLaneId(
      lanes,
      fxLaneId,
      event.key === "ArrowUp" ? -1 : 1,
    );
    if (!nextLaneId) {
      return;
    }

    event.preventDefault();
    setSelectedLaneId(nextLaneId);
    if (activeElement?.hasAttribute("data-lane-label-id")) {
      timelineScroll
        ?.querySelector<HTMLElement>(
          `[data-lane-label-id="${CSS.escape(nextLaneId)}"]`,
        )
        ?.focus();
    }
  },
};
