import type { Dispatch, RefObject, SetStateAction } from "react";
import type { ClipClipboard } from "../app/clip-ops.ts";
import type {
  ArrangementClip,
  DragState,
  Lane,
  SourceSpan,
  SourceTrack,
  TimelineDragState,
  TimelineSelection,
} from "../app/types.ts";
import type { useClipActions } from "../hooks/useClipActions.ts";
import type { useSourceClipActions } from "../hooks/useSourceClipActions.ts";
import type { useSourceTrackActions } from "../hooks/useSourceTrackActions.ts";

type SourceTrackActions = ReturnType<typeof useSourceTrackActions>;

// What the global keyboard shortcuts read and act on.
export type ShortcutContext = {
  bpm: number;
  clipActionsRef: ReturnType<typeof useClipActions>["clipActionsRef"];
  clipClipboardRef: RefObject<ClipClipboard | null>;
  commitPendingSelectionToSourceTrack: (sourceIndex: number) => void;
  deleteSourceTrack: SourceTrackActions["deleteSourceTrack"];
  dragState: DragState | null;
  duplicateSourceTrack: SourceTrackActions["duplicateSourceTrack"];
  fps: number;
  fxLaneId: string | undefined;
  handleRedo: () => void;
  handleUndo: () => void;
  lanes: Lane[];
  pendingSelection: TimelineSelection | null;
  playbackOriginRef: RefObject<number>;
  playheadQRef: RefObject<number>;
  selectedClip: ArrangementClip | undefined;
  // The selected source clip, while no clip is selected.
  selectedSourceSpan: SourceSpan | undefined;
  // The selected source track, while no clip or source clip is selected.
  selectedSourceTrack: SourceTrack | undefined;
  setPendingSelection: Dispatch<SetStateAction<TimelineSelection | null>>;
  setPlayheadQ: (playheadQ: number) => void;
  setSelectedClipId: Dispatch<SetStateAction<string | undefined>>;
  setSelectedLaneId: Dispatch<SetStateAction<string | undefined>>;
  sourceClipActionsRef: ReturnType<
    typeof useSourceClipActions
  >["sourceClipActionsRef"];
  timelineContentEndQ: number;
  timelineDragState: TimelineDragState | null;
  timelineScrollRef: RefObject<HTMLDivElement | null>;
  totalQuarters: number;
};

export type Shortcut = {
  id: string;
  // The key combinations that trigger it; see `matchesShortcutKey`.
  keys: readonly string[];
  // Whether it applies to this key press in this state.
  when: (context: ShortcutContext, event: KeyboardEvent) => boolean;
  // Acts on the key press, preventing its default when it handles it.
  run: (context: ShortcutContext, event: KeyboardEvent) => void;
};
