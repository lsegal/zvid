import { type RefObject, useEffect } from "react";
import type { DragState, TimelineDragState } from "../app/types.ts";
import {
  classifySpaceTarget,
  type createSpaceHold,
  hasOpenPopup,
  isTextEntryTarget,
} from "../space-shortcut";

export type SpacePlaybackInputs = {
  cancelScrubPlaybackResume: () => void;
  clipCount: number;
  dragState: DragState | null;
  isPlaying: boolean;
  // With the preview pane's Media tab open, Space plays the media instead.
  isMediaTabActive: boolean;
  toggleMediaPlayback: () => void;
  setIsPlaying: (isPlaying: boolean) => void;
  spaceHoldRef: { current: ReturnType<typeof createSpaceHold> };
  startPlayback: () => void;
  timelineDragState: TimelineDragState | null;
  timelineScrollRef: RefObject<HTMLDivElement | null>;
};

// Space toggles playback from anywhere except text entry (#745). It runs in
// the capture phase so a focused button, menu trigger, grip or slider never
// sees the key and cannot also activate, and it closes an open menu, listbox
// or popover first. Playback toggles on release, so holding Space to pan the
// timeline never starts it. With the preview pane's Media tab open, it plays
// the previewed media instead.
export function useSpacePlayback({
  cancelScrubPlaybackResume,
  clipCount,
  dragState,
  isPlaying,
  isMediaTabActive,
  toggleMediaPlayback,
  setIsPlaying,
  spaceHoldRef,
  startPlayback,
  timelineDragState,
  timelineScrollRef,
}: SpacePlaybackInputs) {
  useEffect(() => {
    const spaceHold = spaceHoldRef.current;
    const setSpaceHeldClass = (held: boolean) =>
      timelineScrollRef.current?.classList.toggle(
        "timeline-scroll--space-held",
        held,
      );

    const onSpaceKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") {
        return;
      }

      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        classifySpaceTarget(event.target) !== "playback"
      ) {
        spaceHold.cancel();
        setSpaceHeldClass(false);
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat && hasOpenPopup(document)) {
        // Esc closes it the way the user would, returning focus to its
        // trigger.
        (document.activeElement ?? document.body).dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            code: "Escape",
            key: "Escape",
          }),
        );
      }
      spaceHold.press();
      setSpaceHeldClass(true);
    };

    // Native buttons activate on Space keyup, so swallow the matching keyup.
    const onSpaceKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !spaceHold.held) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setSpaceHeldClass(false);
      if (!spaceHold.release()) {
        return;
      }

      if (isMediaTabActive) {
        toggleMediaPlayback();
        return;
      }

      // Playback with nothing to play, as while recording, can still stop.
      if (dragState || timelineDragState || (!clipCount && !isPlaying)) {
        return;
      }

      cancelScrubPlaybackResume();
      if (isPlaying) {
        setIsPlaying(false);
        return;
      }

      startPlayback();
    };

    const onBlur = () => {
      spaceHold.cancel();
      setSpaceHeldClass(false);
    };

    window.addEventListener("keydown", onSpaceKeyDown, true);
    window.addEventListener("keyup", onSpaceKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onSpaceKeyDown, true);
      window.removeEventListener("keyup", onSpaceKeyUp, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [
    cancelScrubPlaybackResume,
    clipCount,
    dragState,
    isMediaTabActive,
    isPlaying,
    setIsPlaying,
    spaceHoldRef,
    startPlayback,
    timelineDragState,
    timelineScrollRef,
    toggleMediaPlayback,
  ]);

  // Lane, clip and ruler presses prevent their default, so a text field
  // focused before them, such as a text clip's FX Text box, kept focus and
  // took every later Space as typing (#924). A press in the timeline outside
  // the field leaves it, as a press anywhere else would.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const active = document.activeElement;
      const target = event.target;
      if (
        active instanceof HTMLElement &&
        isTextEntryTarget(active) &&
        target instanceof Element &&
        !active.contains(target) &&
        target.closest(".timeline-panel")
      ) {
        active.blur();
      }
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);
}
