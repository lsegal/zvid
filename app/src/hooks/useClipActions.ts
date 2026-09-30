import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useRef,
} from "react";
import {
  type ClipClipboard,
  duplicateClip,
  withClipStacks,
} from "../app/clip-ops.ts";
import { patchProjectState } from "../app/session-project.ts";
import { getClipEndQ, getSelectionEndQ } from "../app/timeline-math.ts";
import type {
  ArrangementClip,
  Lane,
  ProjectState,
  SourceSpan,
  TimelineSelection,
} from "../app/types.ts";
import { getNextLaneNumber } from "../app/util.ts";
import {
  type CopyToLayerTarget,
  canSplitAt,
  copyClipToLayer,
  resolvePasteLaneId,
} from "../clip-menu.ts";
import {
  copyClipEffects,
  ensureLayerLayouts,
  type SessionEffect,
} from "../fx-stack";
import { createLaneId } from "../lanes";
import type { ProjectHistoryAction } from "../project-history";
import {
  copyClip,
  copyRange,
  pasteClipboard,
  removeRangeFromLane,
  resolveClipOverlaps,
  withWindowTiming,
} from "../range-edit.ts";
import { MAX_LAYERS } from "../selection-overlaps";

export type ClipActionsInputs = {
  addSourceSpanToArrangement: (sourceSpan: SourceSpan) => void;
  bpm: number;
  clipClipboardRef: RefObject<ClipClipboard | null>;
  clips: ArrangementClip[];
  commitProjectChange: (
    label: string,
    updater: (current: ProjectState) => ProjectState,
  ) => void;
  createSourceSpanClip: (
    span: SourceSpan,
    laneId: string,
  ) => ArrangementClip | null;
  dispatchProject: (action: ProjectHistoryAction<ProjectState>) => void;
  effects: SessionEffect[];
  fxLaneId: string;
  lanes: Lane[];
  playheadQRef: RefObject<number>;
  selectedClip: ArrangementClip | undefined;
  selectedLaneId: string | undefined;
  setPendingSelection: Dispatch<SetStateAction<TimelineSelection | null>>;
  setSelectedClipId: Dispatch<SetStateAction<string | undefined>>;
  setStatus: Dispatch<SetStateAction<string>>;
  timelineClips: ArrangementClip[];
};

// Copy, cut, paste, split, duplicate and delete for arrangement clips and range
// selections, and copying source clips.
export function useClipActions({
  addSourceSpanToArrangement,
  bpm,
  clipClipboardRef,
  clips,
  commitProjectChange,
  createSourceSpanClip,
  dispatchProject,
  effects,
  fxLaneId,
  lanes,
  playheadQRef,
  selectedClip,
  selectedLaneId,
  setPendingSelection,
  setSelectedClipId,
  setStatus,
  timelineClips,
}: ClipActionsInputs) {
  // Clipboard and edit actions shared by the keyboard shortcuts and the clip
  // menus. Each is one undo step.
  function copyArrangementClip(clip: ArrangementClip) {
    clipClipboardRef.current = withClipStacks(copyClip(clip, bpm), effects);
    setStatus(`Copied ${clip.label}.`);
  }

  function removeArrangementClip(clip: ArrangementClip, label: string) {
    const nextSelectedClipId =
      timelineClips.find(
        (item) => item.id !== clip.id && item.laneId === clip.laneId,
      )?.id ?? timelineClips.find((item) => item.id !== clip.id)?.id;

    dispatchProject({
      type: "commit",
      label,
      updater: (current) =>
        patchProjectState(current, {
          clips: current.clips.filter((item) => item.id !== clip.id),
        }),
    });
    setSelectedClipId(nextSelectedClipId);
    setPendingSelection(null);
  }

  function cutArrangementClip(clip: ArrangementClip) {
    clipClipboardRef.current = withClipStacks(copyClip(clip, bpm), effects);
    removeArrangementClip(clip, "Cut clip");
    setStatus(`Cut ${clip.label}.`);
  }

  function deleteArrangementClip(clip: ArrangementClip) {
    removeArrangementClip(clip, "Delete clip");
    setStatus(`Deleted ${clip.label}.`);
  }

  // With a selection, Cut, Copy and Delete act on its span on its layer only.
  // The selection stays, showing what they acted on.
  function copySelectionRange(selection: TimelineSelection) {
    return withClipStacks(
      copyRange(
        timelineClips,
        selection.laneId,
        selection.startQ,
        getSelectionEndQ(selection),
        bpm,
      ),
      effects,
    );
  }

  function removeSelectionRange(selection: TimelineSelection, label: string) {
    const splitClipId = `window-${crypto.randomUUID()}`;
    dispatchProject({
      type: "commit",
      label,
      updater: (current) => {
        const splitClipIds = [splitClipId];
        // A clip split around the range gives its right piece a copy of
        // its stack.
        const copies: Array<[string, string]> = [];
        const clips = removeRangeFromLane(
          current.clips,
          selection.laneId,
          selection.startQ,
          getSelectionEndQ(selection),
          current.bpm,
          (source) => {
            const id = splitClipIds.shift() ?? `window-${crypto.randomUUID()}`;
            copies.push([source.id, id]);
            return id;
          },
        );
        return patchProjectState(current, {
          clips,
          effects: copyClipEffects(current.effects, copies),
        });
      },
    });
  }

  function copySelection(selection: TimelineSelection) {
    const content = copySelectionRange(selection);
    if (!content.fragments.length) {
      setStatus("Nothing in the selection to copy.");
      return;
    }

    clipClipboardRef.current = content;
    setStatus("Copied the selection.");
  }

  function cutSelection(selection: TimelineSelection) {
    const content = copySelectionRange(selection);
    if (!content.fragments.length) {
      setStatus("Nothing in the selection to cut.");
      return;
    }

    clipClipboardRef.current = content;
    removeSelectionRange(selection, "Cut selection");
    setStatus("Cut the selection.");
  }

  function deleteSelection(selection: TimelineSelection) {
    if (!copySelectionRange(selection).fragments.length) {
      return;
    }

    removeSelectionRange(selection, "Delete selection");
    setStatus("Deleted the selection.");
  }

  // Pastes at the playhead on `laneId`, or on the selected layer, keeping the
  // copied pieces' spacing.
  function pasteArrangementClip(laneId?: string) {
    const clipboard = clipClipboardRef.current;
    const [firstFragment] = clipboard?.fragments ?? [];
    if (!clipboard || !firstFragment) {
      return;
    }

    const pasteLaneId =
      laneId ??
      resolvePasteLaneId(
        lanes,
        selectedClip?.laneId,
        selectedLaneId,
        firstFragment.clip.laneId,
      );
    const pastedClipIds = clipboard.fragments.map(
      () => `window-${crypto.randomUUID()}`,
    );
    const pasteQ = playheadQRef.current;
    dispatchProject({
      type: "commit",
      label: "Paste clip",
      updater: (current) => {
        const ids = [...pastedClipIds];
        const { clips, pasted } = pasteClipboard(
          current.clips,
          clipboard,
          pasteLaneId,
          pasteQ,
          current.bpm,
          () => ids.shift() ?? `window-${crypto.randomUUID()}`,
        );
        // Each pasted clip gets the stack its fragment was copied with.
        return patchProjectState(current, {
          clips,
          effects: copyClipEffects(
            current.effects,
            pasted.map((clip, index) => [
              clipboard.fragments[index].clip.id,
              clip.id,
            ]),
            clipboard.effects,
          ),
        });
      },
    });
    setSelectedClipId(pastedClipIds[0]);
    setPendingSelection(null);
    setStatus(
      clipboard.fragments.length === 1
        ? `Pasted ${firstFragment.clip.label}.`
        : `Pasted ${clipboard.fragments.length} clips.`,
    );
  }

  function splitArrangementClip(clip: ArrangementClip) {
    const epsilon = 0.0001;
    const splitQ = playheadQRef.current;
    if (!canSplitAt(clip.startQ, getClipEndQ(clip, bpm), splitQ)) {
      setStatus(`Move the playhead inside ${clip.label} to split it.`);
      return;
    }

    const splitClipId = `window-${crypto.randomUUID()}`;
    dispatchProject({
      type: "commit",
      label: "Split clip",
      updater: (current) => {
        const sourceClip = current.clips.find((item) => item.id === clip.id);
        if (!sourceClip) {
          return current;
        }

        const sourceClipEndQ = getClipEndQ(sourceClip, current.bpm);
        const leftDurationQ = splitQ - sourceClip.startQ;
        const rightDurationQ = sourceClipEndQ - splitQ;
        if (leftDurationQ <= epsilon || rightDurationQ <= epsilon) {
          return current;
        }

        const leftClip = withWindowTiming(
          sourceClip,
          sourceClip.startQ,
          leftDurationQ,
          current.bpm,
        );
        const rightClip = withWindowTiming(
          {
            ...sourceClip,
            id: splitClipId,
          },
          splitQ,
          rightDurationQ,
          current.bpm,
        );

        // Both halves keep the clip's stack.
        return patchProjectState(current, {
          clips: current.clips.flatMap((item) =>
            item.id === sourceClip.id ? [leftClip, rightClip] : [item],
          ),
          effects: copyClipEffects(current.effects, [
            [sourceClip.id, splitClipId],
          ]),
        });
      },
    });
    setSelectedClipId(splitClipId);
    setPendingSelection(null);
    setStatus(`Split ${clip.label} at the playhead.`);
  }

  function duplicateArrangementClip(clip: ArrangementClip) {
    const duplicatedClipId = `window-${crypto.randomUUID()}`;
    dispatchProject({
      type: "commit",
      label: "Duplicate clip",
      updater: (current) => {
        const sourceClip = current.clips.find((item) => item.id === clip.id);
        if (!sourceClip) {
          return current;
        }

        const duplicatedClip = duplicateClip(
          sourceClip,
          current.bpm,
          duplicatedClipId,
        );
        return patchProjectState(current, {
          clips: resolveClipOverlaps(
            [...current.clips, duplicatedClip],
            duplicatedClip,
            current.bpm,
          ),
          effects: copyClipEffects(current.effects, [
            [sourceClip.id, duplicatedClipId],
          ]),
        });
      },
    });
    setSelectedClipId(duplicatedClipId);
    setPendingSelection(null);
    setStatus(`Duplicated ${clip.label}.`);
  }

  function copySourceSpan(span: SourceSpan) {
    const clip = createSourceSpanClip(span, fxLaneId ?? "");
    if (!clip) {
      return;
    }

    clipClipboardRef.current = copyClip(clip, bpm);
    setStatus(`Copied ${clip.label}.`);
  }

  function copySourceSpanToLayer(span: SourceSpan, target: CopyToLayerTarget) {
    if (target.kind === "auto") {
      addSourceSpanToArrangement(span);
      return;
    }

    const clip = createSourceSpanClip(span, "");
    if (!clip) {
      return;
    }

    const result = copyClipToLayer(
      target,
      lanes,
      clips,
      clip,
      () => ({
        id: createLaneId(lanes),
        name: `Layer ${getNextLaneNumber(lanes)}`,
        colorIndex: -1,
      }),
      (nextClips, placed) => resolveClipOverlaps(nextClips, placed, bpm),
    );
    if (!result) {
      setStatus(
        target.kind === "lane"
          ? "That layer no longer exists."
          : `You already have the maximum of ${MAX_LAYERS} layers.`,
      );
      return;
    }

    commitProjectChange("Copy clip to layer", (current) =>
      patchProjectState(current, {
        lanes: result.lanes,
        clips: result.clips,
        ...(result.createdLane
          ? { effects: ensureLayerLayouts(current.effects, [result.lane.id]) }
          : {}),
      }),
    );
    setPendingSelection(null);
    setSelectedClipId(result.clip.id);
    setStatus(`Copied ${clip.label} to ${result.lane.name}.`);
  }

  const clipActions = {
    copy: copyArrangementClip,
    cut: cutArrangementClip,
    paste: pasteArrangementClip,
    split: splitArrangementClip,
    duplicate: duplicateArrangementClip,
    remove: deleteArrangementClip,
    copySelection,
    cutSelection,
    deleteSelection,
  };
  // The keyboard shortcuts read the latest actions without re-subscribing.
  const clipActionsRef = useRef(clipActions);
  clipActionsRef.current = clipActions;

  return {
    copyArrangementClip,
    cutArrangementClip,
    deleteArrangementClip,
    copySelectionRange,
    copySelection,
    cutSelection,
    deleteSelection,
    pasteArrangementClip,
    splitArrangementClip,
    duplicateArrangementClip,
    copySourceSpan,
    copySourceSpanToLayer,
    clipActions,
    clipActionsRef,
  };
}
