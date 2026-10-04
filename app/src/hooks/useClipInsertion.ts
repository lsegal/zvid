import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
} from "react";
import {
  FILL_CLIP_ACCENT,
  FILL_CLIP_TINT,
  MAX_WAND_LAYERS,
  RANDOM_SELECTION_BAR_INCREMENT,
  RANDOM_SELECTION_MAX_BARS,
} from "../app/constants.ts";
import { patchProjectState } from "../app/session-project.ts";
import {
  chooseSourceSpanForWindow,
  getClipDurationQ,
  getClipEndQ,
  quartersToSeconds,
} from "../app/timeline-math.ts";
import type {
  ArrangementClip,
  Lane,
  ProjectState,
  SourceSpan,
  SourceTrack,
  TimelineSelection,
} from "../app/types.ts";
import { getNextLaneNumber, getSwatch, randomFloat } from "../app/util.ts";
import {
  applyWandArrangement,
  createWandLanes,
  getWandEndQ,
} from "../arrangement-wand.ts";
import { addDefaultGain } from "../default-gain.ts";
import { addFillClip, getDefaultFillColor } from "../fill-clip.ts";
import { addFxClip } from "../fx-clip.ts";
import { ensureLayerLayouts, pruneClipEffects } from "../fx-stack";
import { createLaneId } from "../lanes";
import type { MediaItem } from "../media";
import type { ProjectHistoryAction } from "../project-history";
import { buildRandomArrangement } from "../random-arrangement.ts";
import { placeClips } from "../range-edit.ts";
import { dropClipOnFreeLane } from "../source-clip-drop.ts";
import { syncClipsToSourceSpans } from "../source-track-content.ts";
import { addTextClip } from "../text-clip.ts";

export type ClipInsertionInputs = {
  barLength: number;
  bpm: number;
  clips: ArrangementClip[];
  commitProjectChange: (
    label: string,
    updater: (current: ProjectState) => ProjectState,
  ) => void;
  dispatchProject: (action: ProjectHistoryAction<ProjectState>) => void;
  fps: number;
  lanes: Lane[];
  mediaItemsById: Map<string, MediaItem>;
  pendingSelection: TimelineSelection | null;
  playbackOriginRef: RefObject<number>;
  projectDurationFrames: number | undefined;
  setDragPreviewClips: Dispatch<SetStateAction<ArrangementClip[] | null>>;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  setPendingSelection: Dispatch<SetStateAction<TimelineSelection | null>>;
  setPlayheadQ: (nextQ: number) => void;
  setSelectedClipId: Dispatch<SetStateAction<string | undefined>>;
  setStatus: Dispatch<SetStateAction<string>>;
  sourceSpans: SourceSpan[];
  sourceTracks: SourceTrack[];
};

// Creates arrangement clips: windows on source clips, fill, text and FX clips,
// whole source clips, and the wand's randomized arrangement.
export function useClipInsertion({
  barLength,
  bpm,
  clips,
  commitProjectChange,
  dispatchProject,
  fps,
  lanes,
  mediaItemsById,
  pendingSelection,
  playbackOriginRef,
  projectDurationFrames,
  setDragPreviewClips,
  setIsPlaying,
  setPendingSelection,
  setPlayheadQ,
  setSelectedClipId,
  setStatus,
  sourceSpans,
  sourceTracks,
}: ClipInsertionInputs) {
  // A window on `sourceTrack` over the selection's time, showing whatever
  // the track holds there. `sourceSpan`, a source clip of the track, is the
  // first it shows (see source-track-content.ts).
  const createWindowClip = useCallback(
    (
      selection: TimelineSelection,
      sourceTrack: SourceTrack,
      sourceSpan: SourceSpan,
    ): ArrangementClip => {
      const sourceOffsetSeconds =
        sourceSpan.trimStartSeconds - quartersToSeconds(sourceSpan.startQ, bpm);
      const clip: ArrangementClip = {
        id: `window-${crypto.randomUUID()}`,
        sourceSpanId: sourceSpan.id,
        sourceTrackId: sourceTrack.id,
        laneId: selection.laneId,
        label: sourceTrack.name,
        mediaPath: sourceSpan.mediaPath,
        mediaId: sourceSpan.mediaId,
        startQ: selection.startQ,
        durationSeconds: quartersToSeconds(selection.durationQ, bpm),
        trimStartSeconds:
          quartersToSeconds(selection.startQ, bpm) + sourceOffsetSeconds,
        sourceOffsetSeconds,
        sourceSpanOffsetSeconds: sourceOffsetSeconds,
        sourceWindowStartSeconds: sourceSpan.trimStartSeconds,
        sourceWindowEndSeconds:
          sourceSpan.trimStartSeconds + sourceSpan.durationSeconds,
        warp: sourceSpan.warp,
        tint: sourceSpan.tint,
        accent: sourceSpan.accent,
      };
      // Its media fields describe the first source clip it shows.
      return syncClipsToSourceSpans([clip], sourceSpans, sourceSpans, bpm)[0];
    },
    [bpm, sourceSpans],
  );

  const commitPendingSelectionToSourceTrack = useCallback(
    (sourceIndex: number) => {
      if (!pendingSelection) {
        return;
      }

      const sourceTrack = sourceTracks[sourceIndex];
      if (!sourceTrack) {
        setStatus(
          `Source layer ${sourceIndex + 1} is not available in this session.`,
        );
        return;
      }

      // One window over the whole selection, however many source clips
      // it spans; it shows each of them in turn.
      const sourceSpan = chooseSourceSpanForWindow(
        sourceSpans,
        sourceTrack.id,
        pendingSelection.startQ,
        pendingSelection.durationQ,
        bpm,
      );
      if (!sourceSpan) {
        setStatus(
          `Source layer ${sourceIndex + 1} has no clip near this selection yet.`,
        );
        return;
      }

      const newClips = [
        createWindowClip(pendingSelection, sourceTrack, sourceSpan),
      ];
      dispatchProject({
        type: "commit",
        label: "Create window",
        updater: (current) =>
          patchProjectState(current, {
            // The window overwrites what it covers on the layer, as a pasted
            // clip does.
            clips: placeClips(current.clips, newClips, current.bpm),
            effects: addDefaultGain(
              current.effects,
              { clips: newClips },
              current.mediaItems,
            ),
          }),
      });
      setPendingSelection(null);
      setSelectedClipId(newClips[0]?.id);
      setStatus(
        `Committed a window on ${sourceTrack.name} with key ${sourceIndex + 1}.`,
      );
    },
    [
      bpm,
      createWindowClip,
      dispatchProject,
      pendingSelection,
      setPendingSelection,
      setSelectedClipId,
      setStatus,
      sourceSpans,
      sourceTracks,
    ],
  );

  // Inserts a fill clip over `durationQ` quarters from `startQ` on layer
  // `laneId` and selects it. The clip gets its own Color effect, in the
  // layer's accent color or neutral gray. Returns the new clip's id.
  const insertFillClip = useCallback(
    (laneId: string, startQ: number, durationQ: number) => {
      const lane = lanes.find((candidate) => candidate.id === laneId);
      if (!lane || !(durationQ > 0)) {
        return undefined;
      }

      const accent =
        lane.colorIndex >= 0 ? getSwatch(lane.colorIndex).accent : undefined;
      const id = `fill-${crypto.randomUUID()}`;
      dispatchProject({
        type: "commit",
        label: "Insert fill clip",
        updater: (current) => {
          const result = addFillClip(current, {
            id,
            laneId,
            startQ,
            durationQ,
            bpm,
            tint: FILL_CLIP_TINT,
            accent: accent ?? FILL_CLIP_ACCENT,
            color: getDefaultFillColor(accent),
            effectId: crypto.randomUUID(),
          });
          return patchProjectState(current, {
            clips: result.clips,
            effects: result.effects,
          });
        },
      });
      setPendingSelection(null);
      setSelectedClipId(id);
      setStatus(`Inserted a fill on ${lane.name}.`);
      return id;
    },
    [
      bpm,
      dispatchProject,
      lanes,
      setPendingSelection,
      setSelectedClipId,
      setStatus,
    ],
  );

  // Inserts a text clip over `durationQ` quarters from `startQ` on layer
  // `laneId` and selects it. The clip gets its own Text effect with its
  // defaults. Returns the new clip's id.
  const insertTextClip = useCallback(
    (laneId: string, startQ: number, durationQ: number) => {
      const lane = lanes.find((candidate) => candidate.id === laneId);
      if (!lane || !(durationQ > 0)) {
        return undefined;
      }

      const accent =
        lane.colorIndex >= 0 ? getSwatch(lane.colorIndex).accent : undefined;
      const id = `text-${crypto.randomUUID()}`;
      dispatchProject({
        type: "commit",
        label: "Insert text clip",
        updater: (current) => {
          const result = addTextClip(current, {
            id,
            laneId,
            startQ,
            durationQ,
            bpm,
            tint: FILL_CLIP_TINT,
            accent: accent ?? FILL_CLIP_ACCENT,
            effectId: crypto.randomUUID(),
          });
          return patchProjectState(current, {
            clips: result.clips,
            effects: result.effects,
          });
        },
      });
      setPendingSelection(null);
      setSelectedClipId(id);
      setStatus(`Inserted text on ${lane.name}.`);
      return id;
    },
    [
      bpm,
      dispatchProject,
      lanes,
      setPendingSelection,
      setSelectedClipId,
      setStatus,
    ],
  );

  // Inserts an FX clip over `durationQ` quarters from `startQ` on layer
  // `laneId` and selects it, so the FX panel's Clip section opens ready for
  // its first effect. It starts with no effects, so it changes nothing yet.
  // Returns the new clip's id.
  const insertFxClip = useCallback(
    (laneId: string, startQ: number, durationQ: number) => {
      const lane = lanes.find((candidate) => candidate.id === laneId);
      if (!lane || !(durationQ > 0)) {
        return undefined;
      }

      const accent =
        lane.colorIndex >= 0 ? getSwatch(lane.colorIndex).accent : undefined;
      const id = `fx-${crypto.randomUUID()}`;
      dispatchProject({
        type: "commit",
        label: "Insert FX clip",
        updater: (current) =>
          patchProjectState(current, {
            clips: addFxClip(current, {
              id,
              laneId,
              startQ,
              durationQ,
              bpm,
              tint: FILL_CLIP_TINT,
              accent: accent ?? FILL_CLIP_ACCENT,
            }).clips,
          }),
      });
      setPendingSelection(null);
      setSelectedClipId(id);
      setStatus(`Inserted an FX clip on ${lane.name}.`);
      return id;
    },
    [
      bpm,
      dispatchProject,
      lanes,
      setPendingSelection,
      setSelectedClipId,
      setStatus,
    ],
  );

  // The whole source clip as an arrangement clip at its song position.
  function createSourceSpanClip(span: SourceSpan, laneId: string) {
    const sourceTrack = sourceTracks.find(
      (track) => track.id === span.sourceTrackId,
    );
    if (!sourceTrack) {
      return null;
    }

    return createWindowClip(
      {
        id: span.id,
        laneId,
        startQ: span.startQ,
        durationQ: getClipDurationQ(span, bpm),
      },
      sourceTrack,
      span,
    );
  }

  // Ctrl/Cmd-click on a source clip: drops the whole clip onto the last layer
  // with room for it at the same song position, or onto a new layer.
  function addSourceSpanToArrangement(sourceSpan: SourceSpan) {
    const clip = createSourceSpanClip(sourceSpan, "");
    if (!clip) {
      return;
    }

    const drop = dropClipOnFreeLane(lanes, clips, clip, bpm, () => ({
      id: createLaneId(lanes),
      name: `Layer ${getNextLaneNumber(lanes)}`,
      colorIndex: -1,
    }));
    commitProjectChange("Add clip from source", (current) =>
      patchProjectState(current, {
        lanes: drop.lanes,
        clips: drop.clips,
        effects: addDefaultGain(
          drop.createdLane
            ? ensureLayerLayouts(current.effects, [drop.lane.id])
            : current.effects,
          { clips: [drop.clip] },
          current.mediaItems,
        ),
      }),
    );
    setPendingSelection(null);
    setSelectedClipId(drop.clip.id);
    setStatus(
      drop.createdLane
        ? `Added ${clip.label} to a new layer, ${drop.lane.name}.`
        : `Added ${clip.label} to ${drop.lane.name}.`,
    );
  }

  function getRandomizationTimelineEndQ() {
    return getWandEndQ({
      projectDurationFrames,
      fps,
      bpm,
      barLength,
      sourceSpans,
      isVideoSpan: (span) =>
        Boolean(span.mediaId && mediaItemsById.get(span.mediaId)?.hasVideo),
    });
  }

  function buildRandomizedArrangement() {
    const wandLanes = createWandLanes(lanes, MAX_WAND_LAYERS);
    // Sound with no picture, so not stills or offline media.
    const isAudioOnly = (span: SourceSpan) => {
      const media = span.mediaId ? mediaItemsById.get(span.mediaId) : undefined;
      return Boolean(media?.hasAudio && !media.hasVideo);
    };
    const stepQ = barLength * RANDOM_SELECTION_BAR_INCREMENT;
    const durationSteps = Array.from(
      {
        length: Math.round(
          RANDOM_SELECTION_MAX_BARS / RANDOM_SELECTION_BAR_INCREMENT,
        ),
      },
      (_, index) => (index + 1) * stepQ,
    );
    const sourceTracksById = new Map(
      sourceTracks.map((sourceTrack) => [sourceTrack.id, sourceTrack]),
    );
    const windows = buildRandomArrangement({
      laneIds: wandLanes.videoLanes.map((lane) => lane.id),
      audioLaneId: wandLanes.audioLane.id,
      isAudioOnly,
      sourceTrackIds: sourceTracks.map((sourceTrack) => sourceTrack.id),
      spans: sourceSpans,
      spanEndQ: (span) => getClipEndQ(span, bpm),
      timelineEndQ: getRandomizationTimelineEndQ(),
      stepQ,
      durationSteps,
      random: randomFloat,
    });

    const randomizedClips = windows.flatMap((window, index) => {
      const sourceTrack = sourceTracksById.get(window.span.sourceTrackId);
      if (!sourceTrack) {
        return [];
      }

      const clip = createWindowClip(
        {
          id: `selection-random-${window.laneId}-${index}`,
          laneId: window.laneId,
          startQ: window.startQ,
          durationQ: window.durationQ,
        },
        sourceTrack,
        window.span,
      );
      return [clip];
    });
    return { lanes: wandLanes.lanes, clips: randomizedClips };
  }

  function handleRandomizeTimeline() {
    if (!sourceTracks.length || !sourceSpans.length) {
      setStatus(
        "Open a session or import source media before randomizing the arrangement.",
      );
      return;
    }

    const { lanes: wandLanes, clips: randomizedClips } =
      buildRandomizedArrangement();
    if (!randomizedClips.length) {
      setStatus(
        "No randomized windows could be generated from the current source timeline.",
      );
      return;
    }

    setIsPlaying(false);
    setPendingSelection(null);
    setDragPreviewClips(null);
    commitProjectChange("Randomize arrangement", (current) => {
      const next = applyWandArrangement(current, wandLanes, randomizedClips);
      // The old clips' stacks go with them, and each window with sound gets
      // its Gain.
      return {
        ...next,
        effects: addDefaultGain(
          pruneClipEffects(next.effects, randomizedClips),
          { clips: randomizedClips },
          current.mediaItems,
        ),
      };
    });
    setSelectedClipId(randomizedClips[0]?.id);
    setPlayheadQ(0);
    playbackOriginRef.current = 0;
    setStatus(
      `Rebuilt the arrangement with ${randomizedClips.length} randomized windows inside the source clips.`,
    );
  }

  return {
    commitPendingSelectionToSourceTrack,
    insertFillClip,
    insertTextClip,
    insertFxClip,
    createSourceSpanClip,
    addSourceSpanToArrangement,
    handleRandomizeTimeline,
  };
}
