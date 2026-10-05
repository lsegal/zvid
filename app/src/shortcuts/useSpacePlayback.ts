import { type RefObject, useEffect, useRef } from "react";
import type { DragState, TimelineDragState } from "../app/types.ts";
import {
  classifySpaceTarget,
  type createSpaceHold,
  hasOpenPopup,
} from "../space-shortcut";

export type SpacePlaybackInputs = {
  cancelScrubPlaybackResume: () => void;
  clipCount: number;
  dragState: DragState | null;
  isPlaying: boolean;
  // With the preview pane's Media tab open, Space plays the media instead.
  isMediaTabActive: boolean;
  toggleMediaPlayback: () => void;
  // Ctrl/Cmd+Space: play from the loop's in marker.
  playFromLoopStart: () => void;
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
// the previewed media instead. Ctrl/Cmd+Space plays from the loop's in
// marker; macOS usually keeps Cmd+Space and Ctrl+Space for itself, so there
// Cmd-click on Play does it.
export function useSpacePlayback({
  cancelScrubPlaybackResume,
  clipCount,
  dragState,
  isPlaying,
  isMediaTabActive,
  toggleMediaPlayback,
  playFromLoopStart,
  setIsPlaying,
  spaceHoldRef,
  startPlayback,
  timelineDragState,
  timelineScrollRef,
}: SpacePlaybackInputs) {
  // Whether Ctrl or Cmd was down when the held Space was pressed.
  const fromLoopStartRef = useRef(false);
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

      if (event.altKey || classifySpaceTarget(event.target) !== "playback") {
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
      if (!spaceHold.held) {
        fromLoopStartRef.current = event.metaKey || event.ctrlKey;
      }
      spaceHold.press();
      setSpaceHeldClass(true);
    };

    // Native buttons activate on Space keyup, so swallow the matching keyup.
    // macOS sends no keyup for Space released while Cmd is down, so for
    // Ctrl/Cmd+Space the modifier's own release counts too.
    const onSpaceKeyUp = (event: KeyboardEvent) => {
      const releasesModifier =
        fromLoopStartRef.current &&
        (event.key === "Meta" || event.key === "Control");
      if ((event.code !== "Space" && !releasesModifier) || !spaceHold.held) {
        return;
      }

      if (!releasesModifier) {
        event.preventDefault();
        event.stopPropagation();
      }
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
      if (fromLoopStartRef.current) {
        playFromLoopStart();
        return;
      }

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
    playFromLoopStart,
    setIsPlaying,
    spaceHoldRef,
    startPlayback,
    timelineDragState,
    timelineScrollRef,
    toggleMediaPlayback,
  ]);
}
