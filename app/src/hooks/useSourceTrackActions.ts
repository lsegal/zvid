import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useRef,
  useState,
} from "react";
import { patchProjectState } from "../app/session-project.ts";
import type {
  ArrangementClip,
  ProjectState,
  SourceTrack,
} from "../app/types.ts";
import { layerHistoryLabels } from "../layer-menu";
import {
  deleteSourceTrack,
  duplicateSourceTrack,
  moveSourceTrackTo,
  renameSourceTrack,
} from "../source-track-edits.ts";
import { useLayerReorder } from "../use-layer-reorder";

export type SourceTrackActionsInputs = {
  commitProjectChange: (
    label: string,
    updater: (current: ProjectState) => ProjectState,
  ) => void;
  selectedClip: ArrangementClip | undefined;
  setSelectedClipId: Dispatch<SetStateAction<string | undefined>>;
  setStatus: Dispatch<SetStateAction<string>>;
  sourceTracks: SourceTrack[];
  timelineScrollRef: RefObject<HTMLDivElement | null>;
};

// Focuses the label of source track `trackId` once it has rendered.
function focusSourceTrackLabel(trackId: string) {
  window.setTimeout(() => {
    document
      .querySelector<HTMLElement>(
        `[data-source-track-label-id="${CSS.escape(trackId)}"]`,
      )
      ?.focus();
  }, 0);
}

// Renames, duplicates, deletes and moves source tracks, like useLayerActions
// does layers, with the same history labels.
export function useSourceTrackActions({
  commitProjectChange,
  selectedClip,
  setSelectedClipId,
  setStatus,
  sourceTracks,
  timelineScrollRef,
}: SourceTrackActionsInputs) {
  const sourceTracksListRef = useRef<HTMLDivElement | null>(null);
  // The source track whose name is being edited in its label.
  const [renamingSourceTrackId, setRenamingSourceTrackId] = useState<string>();

  // Saves the name typed into the label's field, then focuses the label.
  function commitSourceTrackRename(trackId: string, name: string) {
    setRenamingSourceTrackId(undefined);
    focusSourceTrackLabel(trackId);
    const track = sourceTracks.find((item) => item.id === trackId);
    if (!track) {
      return;
    }

    commitProjectChange(layerHistoryLabels.rename(track.name), (current) =>
      patchProjectState(current, renameSourceTrack(current, trackId, name)),
    );
  }

  function cancelSourceTrackRename(trackId: string) {
    setRenamingSourceTrackId(undefined);
    focusSourceTrackLabel(trackId);
  }

  function duplicateSourceTrackAction(track: SourceTrack) {
    const newTrackId = `source-track-${crypto.randomUUID()}`;
    commitProjectChange(layerHistoryLabels.duplicate(track.name), (current) =>
      patchProjectState(
        current,
        duplicateSourceTrack(
          current,
          track.id,
          newTrackId,
          () => `source-span-${crypto.randomUUID()}`,
        ),
      ),
    );
    focusSourceTrackLabel(newTrackId);
    setStatus(`Duplicated ${track.name}.`);
  }

  function deleteSourceTrackAction(track: SourceTrack) {
    commitProjectChange(layerHistoryLabels.remove(track.name), (current) =>
      patchProjectState(current, deleteSourceTrack(current, track.id)),
    );
    if (selectedClip?.sourceTrackId === track.id) {
      setSelectedClipId(undefined);
    }
    // The track that takes its place in the list, else the one above.
    const index = sourceTracks.findIndex((item) => item.id === track.id);
    const neighbor = sourceTracks[index + 1] ?? sourceTracks[index - 1];
    if (neighbor) {
      focusSourceTrackLabel(neighbor.id);
    }
    setStatus(`Deleted ${track.name}.`);
  }

  function moveSourceTrack(track: SourceTrack, direction: -1 | 1) {
    const index = sourceTracks.findIndex((item) => item.id === track.id);
    commitProjectChange(
      layerHistoryLabels.move(track.name, direction),
      (current) =>
        patchProjectState(
          current,
          moveSourceTrackTo(current, track.id, index + direction),
        ),
    );
    focusSourceTrackLabel(track.id);
  }

  function moveSourceTrackToIndex(trackId: string, targetIndex: number) {
    const track = sourceTracks.find((item) => item.id === trackId);
    if (!track) {
      return;
    }

    commitProjectChange(layerHistoryLabels.moveTo(track.name), (current) =>
      patchProjectState(
        current,
        moveSourceTrackTo(current, trackId, targetIndex),
      ),
    );
  }

  // Dragging a source track label's grip, or picking it up from the
  // keyboard, exactly like a layer header's.
  const sourceTrackReorder = useLayerReorder({
    lanes: sourceTracks,
    listRef: sourceTracksListRef,
    scrollRef: timelineScrollRef,
    getScrollTop: () =>
      timelineScrollRef.current
        ?.querySelector(".ruler-row")
        ?.getBoundingClientRect().bottom,
    rowAttribute: "data-source-track-id",
    gripAttribute: "data-source-track-grip",
    listClass: "source-track-list",
    onMove: moveSourceTrackToIndex,
  });

  return {
    sourceTracksListRef,
    renamingSourceTrackId,
    setRenamingSourceTrackId,
    commitSourceTrackRename,
    cancelSourceTrackRename,
    duplicateSourceTrack: duplicateSourceTrackAction,
    deleteSourceTrack: deleteSourceTrackAction,
    moveSourceTrack,
    sourceTrackReorder,
  };
}
