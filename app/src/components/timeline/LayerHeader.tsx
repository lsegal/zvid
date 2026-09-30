import { Bars3Icon } from "@heroicons/react/24/solid";
import type { Dispatch, SetStateAction } from "react";
import type { Lane } from "../../app/types.ts";
import { isLayerFxEnabled } from "../../fx-stack";
import type { useFxEditing } from "../../hooks/useFxEditing.ts";
import type { useLayerActions } from "../../hooks/useLayerActions.ts";
import type { LaneStatus } from "../../hooks/useTimelineLanes.ts";
import type { useMenus } from "../../menus/useMenus.ts";
import { LayerNameInput } from "../LayerNameInput";

type LayerActions = ReturnType<typeof useLayerActions>;

// What every layer header shares.
export type LayerHeaderContext = {
  layerReorder: LayerActions["layerReorder"];
  renamingLaneId: string | undefined;
  setRenamingLaneId: Dispatch<SetStateAction<string | undefined>>;
  openLayerMenu: ReturnType<typeof useMenus>["openLayerMenu"];
  selectLaneFromLabel: (laneId: string) => void;
  focusLaneLabel: (laneId: string) => void;
  commitLayerRename: LayerActions["commitLayerRename"];
  setLayerFxEnabled: ReturnType<typeof useFxEditing>["setLayerFxEnabled"];
};

type LayerHeaderProps = {
  lane: Lane;
  laneIndex: number;
  // The layer the FX chain edits.
  fxLaneId: string | undefined;
  status: LaneStatus | undefined;
} & LayerHeaderContext;

// A layer's header: the reorder grip, its number, its name (or the field
// renaming it) with a summary, and the FX bypass badge.
export function LayerHeader({
  lane,
  laneIndex,
  fxLaneId,
  status,
  layerReorder,
  renamingLaneId,
  setRenamingLaneId,
  openLayerMenu,
  selectLaneFromLabel,
  focusLaneLabel,
  commitLayerRename,
  setLayerFxEnabled,
}: LayerHeaderProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking anywhere on the label is a mouse shortcut; the layer name button is the keyboard equivalent
    // biome-ignore lint/a11y/useKeyWithClickEvents: the layer name button handles the keyboard
    <div
      className="track-label track-label--lane"
      data-layer-header-id={lane.id}
      onContextMenu={(event) => openLayerMenu(event, lane.id)}
      onClick={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest(".track-label__fx, .track-label__rename")
        ) {
          return;
        }
        selectLaneFromLabel(lane.id);
      }}
    >
      <button
        {...layerReorder.gripProps(lane, laneIndex)}
        aria-label={`Reorder ${lane.name}`}
        className="track-label__grip"
        tabIndex={lane.id === fxLaneId ? 0 : -1}
        title="Drag to reorder, or press Space to pick up"
        type="button"
      >
        <Bars3Icon aria-hidden="true" />
      </button>
      <div className="track-label__index">{laneIndex + 1}</div>
      {renamingLaneId === lane.id ? (
        <LayerNameInput
          initialName={lane.name}
          onCancel={() => {
            setRenamingLaneId(undefined);
            focusLaneLabel(lane.id);
          }}
          onSubmit={(name) => {
            commitLayerRename(lane.id, name);
            focusLaneLabel(lane.id);
          }}
        />
      ) : (
        <button
          aria-current={lane.id === fxLaneId ? "true" : undefined}
          className="track-label__select"
          data-lane-label-id={lane.id}
          tabIndex={lane.id === fxLaneId ? 0 : -1}
          type="button"
        >
          <span>{lane.name}</span>
          <small>{status?.summary}</small>
        </button>
      )}
      <button
        aria-label={`${lane.name} effects`}
        aria-pressed={status?.fxToggle}
        className={`track-label__fx ${status?.fxClassName ?? ""}`}
        disabled={!status?.effectCount}
        onClick={(event) => {
          event.stopPropagation();
          setLayerFxEnabled(lane.id, !isLayerFxEnabled(lane));
        }}
        title={status?.fxTitle}
        type="button"
      >
        fx
      </button>
    </div>
  );
}
