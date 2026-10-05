import type { ReactNode, RefObject } from "react";
import type { ArrangementClip, Lane } from "../../app/types.ts";
import type { LaneStatus } from "../../hooks/useTimelineLanes.ts";
import {
  getRowHeight,
  getRowHeightStyle,
  isRowCollapsed,
  type RowHeights,
} from "../../row-heights.ts";
import { LaneRow, type LaneRowContext } from "./LaneRow";
import { LayerHeader, type LayerHeaderContext } from "./LayerHeader";
import { TrackAddButton } from "./TrackPlaceholder";
import "./arrangement-lanes.css";

// A lane with no clips, shared so its memoized row doesn't re-render.
const NO_CLIPS: ArrangementClip[] = [];

type ArrangementLanesProps = {
  arrangementLanesRef: RefObject<HTMLDivElement | null>;
  lanes: Lane[];
  // The layer the FX chain edits.
  fxLaneId: string | undefined;
  laneStatusById: ReadonlyMap<string, LaneStatus>;
  clipsByLane: ReadonlyMap<string, ArrangementClip[]>;
  rowHeights: RowHeights;
  // The empty arrangement's call to action, when shown.
  emptyState: ReactNode;
  header: LayerHeaderContext;
  row: LaneRowContext;
  // A read-only tab can't add layers.
  readOnly: boolean;
  onCreateLayer: () => void;
};

// The arrangement's layers, each a header and a lane, with the drop
// indicator and announcements that reordering them uses, ended by an empty
// placeholder row whose [ + Layer ] button adds one.
export function ArrangementLanes({
  arrangementLanesRef,
  lanes,
  fxLaneId,
  laneStatusById,
  clipsByLane,
  rowHeights,
  emptyState,
  header,
  row,
  readOnly,
  onCreateLayer,
}: ArrangementLanesProps) {
  const { layerReorder } = header;
  return (
    <div
      ref={arrangementLanesRef}
      className={`arrangement-lanes ${layerReorder.listClassName}`}
    >
      {emptyState}
      <div
        aria-hidden="true"
        className="layer-drop-indicator"
        ref={layerReorder.indicatorRef}
      />
      <div aria-live="polite" className="layer-reorder-status" role="status">
        {layerReorder.announcement}
      </div>
      {lanes.map((lane, laneIndex) => {
        const collapsed = isRowCollapsed(rowHeights, "lane", lane.id);
        return (
          <section
            key={lane.id}
            className={`track-row ${lane.id === fxLaneId ? "track-row--selected" : ""} ${
              lane.id === layerReorder.liftedLaneId ? "track-row--lifted" : ""
            } ${collapsed ? "track-row--collapsed" : ""}`}
            data-layer-row-id={lane.id}
            style={getRowHeightStyle(
              "lane",
              getRowHeight(rowHeights, "lane", lane.id),
            )}
          >
            <LayerHeader
              lane={lane}
              laneIndex={laneIndex}
              fxLaneId={fxLaneId}
              status={laneStatusById.get(lane.id)}
              {...header}
            />
            <LaneRow
              lane={lane}
              clips={clipsByLane.get(lane.id) ?? NO_CLIPS}
              collapsed={collapsed}
              {...row}
            />
          </section>
        );
      })}
      <section className="track-row track-placeholder track-placeholder--layer">
        <div className="track-label">
          <TrackAddButton
            disabled={readOnly}
            label="Layer"
            onClick={onCreateLayer}
            title="Add a layer"
          />
        </div>
        <div className="track-row__content" />
      </section>
    </div>
  );
}
