import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useRef,
} from "react";
import type {
  ArrangementClip,
  ClipMenuState,
  SourceSpan,
  SourceTrack,
  TimelineSelection,
} from "../app/types.ts";
import { clamp } from "../app/util.ts";
import { isContextMenuKey } from "../context-menu.ts";

export type KeyboardContextMenuInputs = {
  fxLaneId: string | undefined;
  pendingSelection: TimelineSelection | null;
  playheadQRef: RefObject<number>;
  quarterPx: number;
  selectedClip: ArrangementClip | undefined;
  selectedSourceSpan: SourceSpan | undefined;
  selectedSourceTrack: SourceTrack | undefined;
  setClipMenu: Dispatch<SetStateAction<ClipMenuState | null>>;
  setSelectedLaneId: Dispatch<SetStateAction<string | undefined>>;
  timelineScrollRef: RefObject<HTMLDivElement | null>;
};

// Opens a menu from the context-menu key or Shift+F10 when no element with
// its own menu has focus.
export function useKeyboardContextMenu({
  fxLaneId,
  pendingSelection,
  playheadQRef,
  quarterPx,
  selectedClip,
  selectedSourceSpan,
  selectedSourceTrack,
  setClipMenu,
  setSelectedLaneId,
  timelineScrollRef,
}: KeyboardContextMenuInputs) {
  // The context-menu key or Shift+F10 with nothing focused opens the menu on
  // the uncommitted selection, the selected clip, the selected source clip's
  // track at the playhead, the selected source track, or the selected layer
  // at the playhead.
  // Below the playhead within `bounds`, a timeline row's.
  function atPlayhead(bounds: DOMRect) {
    return {
      x: clamp(
        bounds.left + playheadQRef.current * quarterPx,
        bounds.left,
        bounds.right,
      ),
      y: bounds.bottom,
    };
  }

  function openSelectionMenu() {
    const timelineScroll = timelineScrollRef.current;
    if (!timelineScroll) {
      return false;
    }

    if (pendingSelection) {
      const selection = timelineScroll.querySelector<HTMLElement>(
        `[data-timeline-lane-id="${CSS.escape(pendingSelection.laneId)}"] .timeline-selection`,
      );
      if (!selection) {
        return false;
      }

      const bounds = selection.getBoundingClientRect();
      setClipMenu({
        kind: "selection",
        anchor: { x: bounds.left, y: bounds.bottom },
      });
      return true;
    }

    if (selectedClip) {
      const card = timelineScroll.querySelector<HTMLElement>(
        `[data-clip-id="${CSS.escape(selectedClip.id)}"]`,
      );
      if (!card) {
        return false;
      }

      const bounds = card.getBoundingClientRect();
      setClipMenu({
        kind: "clip",
        clipId: selectedClip.id,
        anchor: { x: bounds.left, y: bounds.bottom },
      });
      return true;
    }

    if (selectedSourceSpan) {
      const row = timelineScroll.querySelector<HTMLElement>(
        `[data-source-track-id="${CSS.escape(selectedSourceSpan.sourceTrackId)}"] .track-row__content--source`,
      );
      if (!row) {
        return false;
      }

      setClipMenu({
        kind: "source-lane",
        trackId: selectedSourceSpan.sourceTrackId,
        anchor: atPlayhead(row.getBoundingClientRect()),
      });
      return true;
    }

    if (selectedSourceTrack) {
      const label = timelineScroll.querySelector<HTMLElement>(
        `[data-source-track-id="${CSS.escape(selectedSourceTrack.id)}"] .track-label--source`,
      );
      if (!label) {
        return false;
      }

      const bounds = label.getBoundingClientRect();
      setClipMenu({
        kind: "source-track",
        trackId: selectedSourceTrack.id,
        anchor: { x: bounds.left, y: bounds.bottom },
      });
      return true;
    }

    if (!fxLaneId) {
      return false;
    }

    const lane = timelineScroll.querySelector<HTMLElement>(
      `[data-timeline-lane-id="${CSS.escape(fxLaneId)}"]`,
    );
    if (!lane) {
      return false;
    }

    const bounds = lane.getBoundingClientRect();
    setSelectedLaneId(fxLaneId);
    setClipMenu({
      kind: "lane",
      laneId: fxLaneId,
      anchor: atPlayhead(bounds),
    });
    return true;
  }

  const openSelectionMenuRef = useRef(openSelectionMenu);
  openSelectionMenuRef.current = openSelectionMenu;

  // Browsers report both keys as a contextmenu event. Clips, lanes and panels
  // with their own menu handle it first when they have focus; this takes the
  // rest while nothing, or empty timeline space, has focus.
  useEffect(() => {
    let keyboardMenuAt = Number.NEGATIVE_INFINITY;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isContextMenuKey(event)) {
        keyboardMenuAt = event.timeStamp;
      }
    };
    const onContextMenu = (event: MouseEvent) => {
      const fromKeyboard = event.timeStamp - keyboardMenuAt < 1000;
      keyboardMenuAt = Number.NEGATIVE_INFINITY;
      const focused = document.activeElement;
      if (
        !fromKeyboard ||
        event.defaultPrevented ||
        (focused &&
          focused !== document.body &&
          !timelineScrollRef.current?.contains(focused))
      ) {
        return;
      }

      if (openSelectionMenuRef.current()) {
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("contextmenu", onContextMenu);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("contextmenu", onContextMenu);
    };
  }, [timelineScrollRef]);
}
