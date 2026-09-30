import type { Dispatch, RefObject, SetStateAction } from "react";
import { patchProjectState } from "../app/session-project.ts";
import type {
  ArrangementClip,
  Lane,
  ProjectState,
  TimelineSelection,
} from "../app/types.ts";
import { getNextLaneNumber } from "../app/util.ts";
import { ensureLayerLayouts } from "../fx-stack";
import {
  createLaneId,
  deleteLane,
  duplicateLane,
  getNextLaneName,
  insertLane,
  moveLane,
  moveLaneTo,
  renameLane,
} from "../lanes";
import { layerHistoryLabels, MAX_LAYERS_MESSAGE } from "../layer-menu";
import { MAX_LAYERS } from "../selection-overlaps";
import { useLayerReorder } from "../use-layer-reorder";

export type LayerActionsInputs = {
  addFxDevice: (trackId: string, effectName: string, id: string) => void;
  arrangementLanesRef: RefObject<HTMLDivElement | null>;
  canCreateLayer: boolean;
  commitProjectChange: (
    label: string,
    updater: (current: ProjectState) => ProjectState,
  ) => void;
  focusLaneLabel: (laneId: string) => void;
  isExporting: boolean;
  isInspectorCollapsed: boolean;
  lanes: Lane[];
  pendingSelection: TimelineSelection | null;
  selectLaneFromLabel: (laneId: string) => void;
  selectedClip: ArrangementClip | undefined;
  setPendingSelection: Dispatch<SetStateAction<TimelineSelection | null>>;
  setRenamingLaneId: Dispatch<SetStateAction<string | undefined>>;
  setSelectedClipId: Dispatch<SetStateAction<string | undefined>>;
  setStatus: Dispatch<SetStateAction<string>>;
  timelineScrollRef: RefObject<HTMLDivElement | null>;
  toggleInspectorCollapsed: () => void;
};

// Creates, inserts, duplicates, deletes, moves and renames layers, and adds
// layer FX.
export function useLayerActions({
  addFxDevice,
  arrangementLanesRef,
  canCreateLayer,
  commitProjectChange,
  focusLaneLabel,
  isExporting,
  isInspectorCollapsed,
  lanes,
  pendingSelection,
  selectLaneFromLabel,
  selectedClip,
  setPendingSelection,
  setRenamingLaneId,
  setSelectedClipId,
  setStatus,
  timelineScrollRef,
  toggleInspectorCollapsed,
}: LayerActionsInputs) {
  function handleCreateLayer() {
    if (!canCreateLayer) {
      setStatus(`You already have the maximum of ${MAX_LAYERS} layers.`);
      return;
    }

    const nextLayerNumber = getNextLaneNumber(lanes);
    const nextLane: Lane = {
      id: createLaneId(lanes),
      name: `Layer ${nextLayerNumber}`,
      colorIndex: -1,
    };

    commitProjectChange("Create layer", (current) =>
      patchProjectState(current, {
        lanes: [...current.lanes, nextLane],
        effects: ensureLayerLayouts(current.effects, [nextLane.id]),
      }),
    );
    setStatus(`Created ${nextLane.name}.`);
  }

  function insertLayer(laneId: string, where: "above" | "below") {
    const index = lanes.findIndex((lane) => lane.id === laneId);
    if (index < 0) {
      return;
    }
    if (!canCreateLayer) {
      setStatus(MAX_LAYERS_MESSAGE);
      return;
    }

    const nextLane: Lane = {
      id: createLaneId(lanes),
      name: getNextLaneName(lanes),
      colorIndex: -1,
    };
    commitProjectChange(
      layerHistoryLabels.insert(lanes[index].name, where),
      (current) =>
        patchProjectState(
          current,
          insertLane(current, where === "above" ? index : index + 1, nextLane),
        ),
    );
    focusLaneLabel(nextLane.id);
    setStatus(`Created ${nextLane.name}.`);
  }

  function duplicateLayer(lane: Lane) {
    if (!canCreateLayer) {
      setStatus(MAX_LAYERS_MESSAGE);
      return;
    }

    const newLaneId = createLaneId(lanes);
    commitProjectChange(layerHistoryLabels.duplicate(lane.name), (current) =>
      patchProjectState(
        current,
        duplicateLane(current, lane.id, newLaneId, (kind) =>
          kind === "clip"
            ? `window-${crypto.randomUUID()}`
            : crypto.randomUUID(),
        ),
      ),
    );
    focusLaneLabel(newLaneId);
    setStatus(`Duplicated ${lane.name}.`);
  }

  function deleteLayer(lane: Lane) {
    if (lanes.length <= 1) {
      return;
    }

    commitProjectChange(layerHistoryLabels.remove(lane.name), (current) =>
      patchProjectState(current, deleteLane(current, lane.id)),
    );
    if (selectedClip?.laneId === lane.id) {
      setSelectedClipId(undefined);
    }
    if (pendingSelection?.laneId === lane.id) {
      setPendingSelection(null);
    }
    // The layer that takes its place in the list, else the one above.
    const index = lanes.findIndex((item) => item.id === lane.id);
    const neighbor = lanes[index + 1] ?? lanes[index - 1];
    if (neighbor) {
      focusLaneLabel(neighbor.id);
    }
    setStatus(`Deleted ${lane.name}.`);
  }

  function moveLayer(lane: Lane, direction: -1 | 1) {
    commitProjectChange(
      layerHistoryLabels.move(lane.name, direction),
      (current) =>
        patchProjectState(current, moveLane(current, lane.id, direction)),
    );
    focusLaneLabel(lane.id);
  }

  function moveLayerTo(laneId: string, targetIndex: number) {
    const lane = lanes.find((item) => item.id === laneId);
    if (!lane) {
      return;
    }

    commitProjectChange(layerHistoryLabels.moveTo(lane.name), (current) =>
      patchProjectState(current, moveLaneTo(current, laneId, targetIndex)),
    );
  }

  // Dragging a layer header's grip, or picking it up from the keyboard.
  const layerReorder = useLayerReorder({
    lanes,
    listRef: arrangementLanesRef,
    scrollRef: timelineScrollRef,
    getScrollTop: () =>
      timelineScrollRef.current
        ?.querySelector(".ruler-row")
        ?.getBoundingClientRect().bottom,
    disabled: isExporting,
    onMove: moveLayerTo,
    onSelect: selectLaneFromLabel,
  });

  function commitLayerRename(laneId: string, name: string) {
    setRenamingLaneId(undefined);
    const lane = lanes.find((item) => item.id === laneId);
    if (!lane) {
      return;
    }

    commitProjectChange(layerHistoryLabels.rename(lane.name), (current) =>
      patchProjectState(current, renameLane(current, laneId, name)),
    );
  }

  // Adds an effect to the layer's chain and shows it in the FX panel.
  function addLayerFx(laneId: string, effectName: string) {
    selectLaneFromLabel(laneId);
    addFxDevice(laneId, effectName, crypto.randomUUID());
    if (isInspectorCollapsed) {
      toggleInspectorCollapsed();
    }
  }

  return {
    handleCreateLayer,
    insertLayer,
    duplicateLayer,
    deleteLayer,
    moveLayer,
    layerReorder,
    commitLayerRename,
    addLayerFx,
  };
}
