import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { INITIAL_PROJECT_STATE, SIGNATURES } from "../app/constants.ts";
import { getShortcutLabels } from "../app/shortcut-labels.ts";
import type { ProjectState, TimelineSelection } from "../app/types.ts";
import { FxPanel } from "../components/FxPanel";
import {
  FxAnimationTimelineContext,
  FxModulationClockContext,
} from "../components/fx/modulation-clock.ts";
import { PreviewTransformOverlay } from "../components/PreviewTransformOverlay";
import {
  ClipCard,
  type ClipCardContext,
} from "../components/timeline/ClipCard";
import { SelectionOverlay } from "../components/timeline/SelectionOverlay";
import { useClipInsertion } from "../hooks/useClipInsertion.ts";
import { useFxContexts } from "../hooks/useFxContexts.ts";
import { useFxEditing } from "../hooks/useFxEditing.ts";
import { useFxPanelModel } from "../hooks/useFxPanelModel.ts";
import { usePreview } from "../hooks/usePreview.ts";
import { useTimelineSelection } from "../hooks/useTimelineSelection.ts";
import { createPlayheadSignal } from "../playhead-signal";
import {
  createProjectHistoryState,
  type ProjectHistoryState,
  projectHistoryReducer,
} from "../project-history";
import { redoShortcut, undoShortcut } from "../shortcuts/history.ts";
import { matchesShortcutKey } from "../shortcuts/keys.ts";
import type { Shortcut, ShortcutContext } from "../shortcuts/types.ts";

// A text clip's editing surfaces as App wires them: the preview's transform
// overlay with its on-canvas text editor (usePreview), the FX panel, and
// the clip's card on its layer, all on one project history with App's undo
// and redo shortcuts and its timeline selection (useTimelineSelection).
//
// `selection` starts with that range selection on its layer, and an Insert
// Text Clip button, standing in for the selection menu's item, turns it into
// a text clip through App's own useClipInsertion, so undo can remove it.
// `isPlaying` starts and stops playback. A test reads the project through
// `onChange`, which runs with each new history.

export const QUARTER_PX = 40;
// The preview monitor's size, in CSS pixels. A 16:9 canvas leaves bands
// above and below it, where a click lands on no layer.
export const MONITOR = { width: 640, height: 400 } as const;

export type TextWorkspaceProps = {
  project?: ProjectState;
  selectedClipId?: string;
  selection?: TimelineSelection;
  playheadQ?: number;
  isPlaying?: boolean;
  onChange?: (history: ProjectHistoryState<ProjectState>) => void;
};

const HISTORY_SHORTCUTS: Shortcut[] = [undoShortcut, redoShortcut];
const noop = () => {};

export function TextWorkspace({
  project = INITIAL_PROJECT_STATE,
  selectedClipId,
  selection: rangeSelection,
  playheadQ: initialPlayheadQ = 0,
  isPlaying: playing = false,
  onChange,
}: TextWorkspaceProps) {
  const [history, dispatchProject] = useReducer(
    projectHistoryReducer<ProjectState>,
    project,
    createProjectHistoryState,
  );
  const present = history.present;
  const projectSnapshotRef = useRef(present);
  projectSnapshotRef.current = present;

  useEffect(() => {
    onChange?.(history);
  }, [history, onChange]);

  const selection = useTimelineSelection({
    restoredSession: null,
    clips: present.clips,
    sourceSpans: present.sourceSpans,
    effects: present.effects,
    sourceTracks: present.sourceTracks,
  });
  const { setSelectedClipId, setPendingSelection } = selection;
  // biome-ignore lint/correctness/useExhaustiveDependencies: selects the clip given on mount
  useEffect(() => {
    if (selectedClipId !== undefined) {
      setSelectedClipId(selectedClipId);
    }
  }, []);

  const [isPlaying, setIsPlaying] = useState(playing);
  useEffect(() => setIsPlaying(playing), [playing]);
  const [playheadQ, setPlayheadQState] = useState(initialPlayheadQ);
  const playheadQRef = useRef(playheadQ);
  playheadQRef.current = playheadQ;
  const playbackOriginRef = useRef(initialPlayheadQ);
  const [playheadSignal] = useState(() =>
    createPlayheadSignal(initialPlayheadQ),
  );
  const setPlayheadQ = useCallback(
    (nextQ: number) => {
      playheadQRef.current = nextQ;
      playheadSignal.set(nextQ);
      setPlayheadQState(nextQ);
    },
    [playheadSignal],
  );

  const lanePriority = useMemo(
    () => new Map(present.lanes.map((lane, index) => [lane.id, index])),
    [present.lanes],
  );
  const mediaItemsById = useMemo(
    () => new Map(present.mediaItems.map((item) => [item.id, item])),
    [present.mediaItems],
  );
  const commitProjectChange = useCallback(
    (label: string, updater: (current: ProjectState) => ProjectState) =>
      dispatchProject({ type: "commit", label, updater }),
    [],
  );

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

  const fxEditing = useFxEditing({
    dispatchProject,
    commitProjectChange,
    lanes: present.lanes,
    sourceTracks: present.sourceTracks,
    timelineClipsRef: selection.timelineClipsRef,
    projectSnapshotRef,
  });
  const preview = usePreview({
    project: present,
    selection,
    mediaItemsById,
    lanePriority,
    editEffects: fxEditing.editEffects,
    isPlaying,
    setIsPlaying,
    playbackOriginRef,
    playheadQ,
    playheadQRef,
    setPlayheadQ,
    refuseReadOnlyEdit: () => false,
  });
  const fxPanel = useFxPanelModel({
    lanes: present.lanes,
    effects: present.effects,
    selectedLaneId: selection.selectedLaneId,
    selectedClip: selection.selectedClip,
    sourceSelection: selection.sourceSelection,
    sourceTracks: present.sourceTracks,
    sourceSpans: present.sourceSpans,
    mediaItemsById,
    lanePriority,
    timelineClips: selection.timelineClips,
    playheadQ,
    bpm: present.bpm,
  });
  const { modulationClock, animationTimeline } = useFxContexts({
    playheadSignal,
    bpm: present.bpm,
    fps: present.fps,
    signature:
      SIGNATURES.find(({ id }) => id === present.signatureId) ?? SIGNATURES[0],
    isPlaying,
    timelineClips: selection.timelineClips,
    lanePriority,
    fxLaneId: fxPanel.fxLaneId,
    fxClipId: selection.selectedClip?.id,
    projectDurationFrames: present.projectDurationFrames,
  });

  const { insertTextClip } = useClipInsertion({
    barLength: 4,
    bpm: present.bpm,
    clips: present.clips,
    commitProjectChange,
    dispatchProject,
    fps: present.fps,
    lanes: present.lanes,
    mediaItemsById,
    pendingSelection: selection.pendingSelection,
    playbackOriginRef,
    projectDurationFrames: present.projectDurationFrames,
    setDragPreviewClips: selection.setDragPreviewClips,
    setIsPlaying,
    setPendingSelection,
    setPlayheadQ,
    setSelectedClipId,
    setStatus: noop,
    sourceSpans: present.sourceSpans,
    sourceTracks: present.sourceTracks,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: the range selection given on mount
  useEffect(() => {
    if (rangeSelection) {
      setPendingSelection(rangeSelection);
    }
  }, []);
  const { pendingSelection } = selection;

  const cardContext = clipCardContext({
    selectedClipId: selection.selectedClipId,
    bpm: present.bpm,
    mediaItemsById,
    timelineEffects: selection.timelineEffects,
    effects: present.effects,
    startTextEdit: preview.startTextEdit,
    setPendingSelection,
    setSelectedClipId,
  });

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
      <div style={{ width: MONITOR.width, flex: "none" }}>
        <div
          className="text-workspace__outside"
          style={{ height: 40 }}
          data-testid="outside"
        >
          {pendingSelection ? (
            <button
              type="button"
              onClick={() =>
                insertTextClip(
                  pendingSelection.laneId,
                  pendingSelection.startQ,
                  pendingSelection.durationQ,
                )
              }
            >
              Insert Text Clip
            </button>
          ) : null}
        </div>
        <div
          className="text-workspace__monitor"
          style={{
            position: "relative",
            ...MONITOR,
            background: "#000",
          }}
        >
          <PreviewTransformOverlay
            canvas={{
              width: present.canvasWidth,
              height: present.canvasHeight,
            }}
            layers={preview.previewLayers}
            selectedLaneId={selection.previewLaneId}
            selectedClipId={selection.selectedClip?.id}
            textEdit={preview.previewTextEdit}
            getLayerPosition={preview.getPreviewLayerPosition}
            getLayerTransform={preview.getPreviewLayerTransform}
            onSelect={preview.selectPreviewLayer}
            onMove={preview.movePreviewLayer}
            onTransform={preview.transformPreviewLayer}
            onActivate={preview.activatePreviewLayer}
          />
        </div>
        {present.lanes.map((lane) => (
          <LaneRowStub key={lane.id} laneId={lane.id}>
            {selection.pendingSelection?.laneId === lane.id ? (
              <SelectionOverlay
                selection={selection.pendingSelection}
                quarterPx={QUARTER_PX}
                onEditPress={noop}
              />
            ) : null}
            {selection.timelineClips
              .filter((clip) => clip.laneId === lane.id)
              .map((clip) => (
                <ClipCard key={clip.id} clip={clip} {...cardContext} />
              ))}
          </LaneRowStub>
        ))}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <FxModulationClockContext.Provider value={modulationClock}>
          <FxAnimationTimelineContext.Provider value={animationTimeline}>
            <FxPanel
              {...fxEditing}
              {...fxPanel}
              isInspectorCollapsed={false}
              toggleInspectorCollapsed={noop}
              sourceClip={null}
            />
          </FxAnimationTimelineContext.Provider>
        </FxModulationClockContext.Provider>
      </div>
    </div>
  );
}

// A layer's clip row, positioning its cards and selection as the timeline
// lane does.
function LaneRowStub({
  laneId,
  children,
}: {
  laneId: string;
  children: ReactNode;
}) {
  return (
    <div
      data-timeline-lane-id={laneId}
      style={{ position: "relative", height: 56, marginTop: 8 }}
    >
      {children}
    </div>
  );
}

// What ClipCard reads from the timeline, with no drag, thumbnails or media
// sync in progress.
export function clipCardContext(
  context: Pick<
    ClipCardContext,
    | "selectedClipId"
    | "bpm"
    | "mediaItemsById"
    | "timelineEffects"
    | "effects"
    | "startTextEdit"
    | "setPendingSelection"
    | "setSelectedClipId"
  >,
): ClipCardContext {
  return {
    dragState: null,
    quarterPx: QUARTER_PX,
    visibleTimelineStartPx: 0,
    visibleTimelineWidthPx: MONITOR.width,
    signature: SIGNATURES[0],
    thumbnails: { get: () => undefined },
    clipPieces: new Map(),
    clipFilmstrips: new Map(),
    remoteMediaProgress: new Map(),
    prefersReducedMotion: true,
    revealedMediaIds: new Set(),
    shortcutLabels: getShortcutLabels(),
    openArrangementClipMenu: noop,
    setDragPreviewClips: noop,
    setDragState: noop,
    ...context,
  };
}
