import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { beforeEach } from "vitest";
import { INITIAL_PROJECT_STATE, signatureById } from "../app/constants.ts";
import type { SourceSelection } from "../app/source-selection.ts";
import type { ArrangementClip, ProjectState } from "../app/types.ts";
import { FxPanel } from "../components/FxPanel";
import {
  FxAnimationTimelineContext,
  FxModulationClockContext,
} from "../components/fx/modulation-clock.ts";
import { useFxContexts } from "../hooks/useFxContexts.ts";
import { useFxEditing } from "../hooks/useFxEditing.ts";
import { useFxPanelModel } from "../hooks/useFxPanelModel.ts";
import { createPlayheadSignal } from "../playhead-signal";
import {
  createProjectHistoryState,
  type ProjectHistoryState,
  projectHistoryReducer,
} from "../project-history";
import { redoShortcut, undoShortcut } from "../shortcuts/history.ts";
import { matchesShortcutKey } from "../shortcuts/keys.ts";
import type { Shortcut, ShortcutContext } from "../shortcuts/types.ts";

// The FX panel as App wires it: the project's undo history, the FX panel
// model for a selection, the FX edits, and the clock and timeline contexts
// its graphs read. Undo and redo use App's own shortcuts.
//
// A test reads the project through `onChange`, which runs with each new
// history, and changes the selection by rendering again with new props.

export type FxEditorSelection = {
  laneId?: string;
  clipId?: string;
  source?: SourceSelection;
};

export type FxEditorProps = {
  project?: ProjectState;
  // A whole history to start from instead of `project`, such as one
  // restored from a saved session.
  history?: ProjectHistoryState<ProjectState>;
  selection?: FxEditorSelection;
  playheadQ?: number;
  onChange?: (history: ProjectHistoryState<ProjectState>) => void;
};

// The FX chain keeps folded devices and sections in localStorage. Each
// test starts from a fresh App's empty storage.
beforeEach(() => {
  localStorage.clear();
});

const HISTORY_SHORTCUTS: Shortcut[] = [undoShortcut, redoShortcut];

export function FxEditor({
  project = INITIAL_PROJECT_STATE,
  history: initialHistory,
  selection = {},
  playheadQ = 0,
  onChange,
}: FxEditorProps) {
  const [history, dispatchProject] = useReducer(
    projectHistoryReducer<ProjectState>,
    project,
    (initial) => initialHistory ?? createProjectHistoryState(initial),
  );
  const present = history.present;
  const projectSnapshotRef = useRef(present);
  projectSnapshotRef.current = present;
  const timelineClipsRef = useRef<ArrangementClip[]>(present.clips);
  timelineClipsRef.current = present.clips;
  const [isInspectorCollapsed, setInspectorCollapsed] = useState(false);

  useEffect(() => {
    onChange?.(history);
  }, [history, onChange]);

  useEffect(() => {
    const context = {
      handleUndo: () => dispatchProject({ type: "undo" }),
      handleRedo: () => dispatchProject({ type: "redo" }),
    } as unknown as ShortcutContext;
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = HISTORY_SHORTCUTS.find(
        (candidate) =>
          candidate.keys.some((key) => matchesShortcutKey(key, event)) &&
          (candidate.when?.(context, event) ?? true),
      );
      shortcut?.run(context, event);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const lanePriority = useMemo(
    () => new Map(present.lanes.map((lane, index) => [lane.id, index])),
    [present.lanes],
  );
  const mediaItemsById = useMemo(
    () => new Map(present.mediaItems.map((item) => [item.id, item])),
    [present.mediaItems],
  );
  const selectedClip = present.clips.find(
    (clip) => clip.id === selection.clipId,
  );

  const fxEditing = useFxEditing({
    dispatchProject,
    commitProjectChange: (label, updater) =>
      dispatchProject({ type: "commit", label, updater }),
    lanes: present.lanes,
    sourceTracks: present.sourceTracks,
    timelineClipsRef,
    projectSnapshotRef,
  });
  const fxPanel = useFxPanelModel({
    lanes: present.lanes,
    effects: present.effects,
    selectedLaneId: selection.laneId ?? selectedClip?.laneId,
    selectedClip,
    sourceSelection: selection.source,
    sourceTracks: present.sourceTracks,
    sourceSpans: present.sourceSpans,
    mediaItemsById,
    lanePriority,
    timelineClips: present.clips,
    playheadQ,
    bpm: present.bpm,
  });

  const [playheadSignal] = useState(() => createPlayheadSignal(playheadQ));
  const { modulationClock, animationTimeline } = useFxContexts({
    playheadSignal,
    bpm: present.bpm,
    fps: present.fps,
    signature:
      signatureById(present.signatureId),
    isPlaying: false,
    timelineClips: present.clips,
    lanePriority,
    fxLaneId: fxPanel.fxLaneId,
    fxClipId: selectedClip?.id,
    projectDurationFrames: present.projectDurationFrames,
  });

  return (
    <FxModulationClockContext.Provider value={modulationClock}>
      <FxAnimationTimelineContext.Provider value={animationTimeline}>
        <FxPanel
          {...fxEditing}
          {...fxPanel}
          isInspectorCollapsed={isInspectorCollapsed}
          toggleInspectorCollapsed={() =>
            setInspectorCollapsed((collapsed) => !collapsed)
          }
          sourceClip={null}
        />
      </FxAnimationTimelineContext.Provider>
    </FxModulationClockContext.Provider>
  );
}
