import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useRef,
} from "react";
import { isContextMenuPress } from "../../context-menu.ts";
import { isRulerPanPress } from "../../drag-scroll.ts";
import { type DragScrollEnd, useDragScroll } from "../../use-drag-scroll";
import { usePrefersReducedMotion } from "../MediaSyncSkeleton";

type PianoRollPanOptions = {
  scrollRef: RefObject<HTMLElement | null>;
  mac: boolean;
  // A right-click, one that never became a drag, pressed this note.
  onRightClickNote: (index: number) => void;
};

// Panning the piano roll by right-dragging (Ctrl-dragging on macOS) or
// middle-dragging its grid, with the main timeline's threshold and momentum.
export function usePianoRollPan({
  scrollRef,
  mac,
  onRightClickNote,
}: PianoRollPanOptions) {
  // The note a right press landed on.
  const pressedNoteRef = useRef<number | undefined>(undefined);
  // Whether a right press still has its contextmenu to come: at the press or
  // at the release, depending on the platform.
  const menuPendingRef = useRef(false);
  const reducedMotion = usePrefersReducedMotion();

  const pan = useDragScroll({
    scrollRef,
    canStart: (event) => isRulerPanPress(event, mac),
    axis: "both",
    momentum: !reducedMotion,
    onStart(event: ReactPointerEvent<HTMLElement>) {
      const rightPress = isContextMenuPress(event, mac);
      menuPendingRef.current = rightPress;
      const note =
        rightPress &&
        (event.target as Element).closest<HTMLElement>("[data-note-index]");
      pressedNoteRef.current = note ? Number(note.dataset.noteIndex) : undefined;
    },
    onEnd({ dragged, released }: DragScrollEnd) {
      if (dragged || !released) {
        // The drag swallows its own contextmenu.
        menuPendingRef.current = false;
      } else if (pressedNoteRef.current !== undefined) {
        onRightClickNote(pressedNoteRef.current);
      }
    },
  });

  return {
    handlers: pan.handlers,
    isGrabbing: pan.isGrabbing,
    // Whether a contextmenu belongs to a right press, rather than to a long
    // press or the menu key, which open the note menu.
    claimContextMenu() {
      const pending = menuPendingRef.current;
      menuPendingRef.current = false;
      return pending;
    },
  };
}
