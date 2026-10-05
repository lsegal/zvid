import { Bars3Icon } from "@heroicons/react/24/solid";
import type { Dispatch, SetStateAction } from "react";
import type { Lane } from "../../app/types.ts";
import type { useFxEditing } from "../../hooks/useFxEditing.ts";
import type { useLayerActions } from "../../hooks/useLayerActions.ts";
import type { LaneStatus } from "../../hooks/useTimelineLanes.ts";
import type { useMenus } from "../../menus/useMenus.ts";
import {
  DEFAULT_ROW_METRICS,
  isRowCollapseTarget,
  MAX_ROW_HEIGHT_SCALE,
  type RowKind,
} from "../../row-heights.ts";
import { NameInput } from "../NameInput";
import { RowResizeHandle } from "./RowResizeHandle";
import { TrackFxButton } from "./TrackFxButton";
import { TrackHideButton } from "./TrackHideButton";
import "./layer-header.css";

type LayerActions = ReturnType<typeof useLayerActions>;

// What every layer header shares.
export type LayerHeaderContext = {
  layerReorder: LayerActions["layerReorder"];
  renamingLaneId: string | undefined;
  setRenamingLaneId: Dispatch<SetStateAction<string | undefined>>;
  // A read-only tab ignores a double-click on the name instead of renaming.
  readOnly: boolean;
  openLayerMenu: ReturnType<typeof useMenus>["openLayerMenu"];
  selectLaneFromLabel: (laneId: string) => void;
  focusLaneLabel: (laneId: string) => void;
  commitLayerRename: LayerActions["commitLayerRename"];
  setLayerFxEnabled: ReturnType<typeof useFxEditing>["setLayerFxEnabled"];
  setLayerHidden: ReturnType<typeof useFxEditing>["setLayerHidden"];
  toggleRowCollapsed: (kind: RowKind, id: string) => void;
  resizeRow: (
    kind: RowKind,
    id: string,
    height: number,
    expandedHeight: number,
  ) => void;
};

type LayerHeaderProps = {
  lane: Lane;
  laneIndex: number;
  // The layer the FX chain edits.
  fxLaneId: string | undefined;
  status: LaneStatus | undefined;
  // The row's height and what expanding it restores (row-heights.ts).
  height: number;
  expandedHeight: number;
} & LayerHeaderContext;

// A layer's header: the reorder grip, its number, its name (or the field
// renaming it) with a summary, and the Hide and FX bypass switches. Double-clicking the
// name renames the layer, like Rename… in its menu, and double-clicking the
// rest of the header collapses or expands its row. Dragging the separator
// along its bottom resizes the row.
export function LayerHeader({
  lane,
  laneIndex,
  fxLaneId,
  status,
  height,
  expandedHeight,
  layerReorder,
  renamingLaneId,
  setRenamingLaneId,
  readOnly,
  openLayerMenu,
  selectLaneFromLabel,
  focusLaneLabel,
  commitLayerRename,
  setLayerFxEnabled,
  setLayerHidden,
  toggleRowCollapsed,
  resizeRow,
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
          event.target.closest(
            ".track-label__hide, .track-label__fx, .track-label__rename",
          )
        ) {
          return;
        }
        selectLaneFromLabel(lane.id);
      }}
      onDoubleClick={(event) => {
        if (isRowCollapseTarget(event.target)) {
          toggleRowCollapsed("lane", lane.id);
        }
      }}
    >
      <button
        {...layerReorder.gripProps(lane, laneIndex)}
        aria-label={`Reorder ${lane.name}`}
        className="track-label__grip"
        tabIndex={lane.id === fxLaneId ? 0 : -1}
        title="Drag to reorder, or press Enter to pick up"
        type="button"
      >
        <Bars3Icon aria-hidden="true" />
      </button>
      <div className="track-label__index">{laneIndex + 1}</div>
      {renamingLaneId === lane.id ? (
        <NameInput
          initialName={lane.name}
          label="Layer name"
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
          onDoubleClick={() => {
            if (!readOnly) {
              setRenamingLaneId(lane.id);
            }
          }}
          tabIndex={lane.id === fxLaneId ? 0 : -1}
          type="button"
        >
          <span>{lane.name}</span>
          <small>{status?.summary}</small>
        </button>
      )}
      <TrackHideButton
        track={lane}
        setHidden={(hidden) => setLayerHidden(lane.id, hidden)}
      />
      <TrackFxButton
        track={lane}
        setFxEnabled={(enabled) => setLayerFxEnabled(lane.id, enabled)}
      />
      <RowResizeHandle
        label={`Resize ${lane.name}`}
        height={height}
        maxHeight={DEFAULT_ROW_METRICS.lane.height * MAX_ROW_HEIGHT_SCALE}
        expandedHeight={expandedHeight}
        onResize={(nextHeight, nextExpandedHeight) =>
          resizeRow("lane", lane.id, nextHeight, nextExpandedHeight)
        }
      />
    </div>
  );
}
