import { ChevronDownIcon } from "@heroicons/react/24/solid";
import type { ReactNode, RefObject } from "react";
import type { ArrangementClip, Lane } from "../../app/types.ts";
import { pluralize } from "../../app/util.ts";
import type { LaneStatus } from "../../hooks/useTimelineLanes.ts";
import { layersToggleLabel } from "../../layers-section.ts";
import {
  DEFAULT_ROW_METRICS,
  getRowExpandedHeight,
  getRowHeight,
  getRowHeightStyle,
  getRowSizeClassName,
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
  // Hidden by the ruler's layers toggle, the layers give way to a collapsed
  // header whose expander shows them again.
  isLayersCollapsed: boolean;
  setLayersCollapsed: (collapsed: boolean) => void;
};

// The arrangement's layers, each a header and a lane, with the drop
// indicator and announcements that reordering them uses, ended by an empty
// placeholder row whose [ + Layer ] button adds one. Hidden, they're a
// collapsed Layers header styled like the collapsed Source Tracks section's.
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
  isLayersCollapsed,
  setLayersCollapsed,
}: ArrangementLanesProps) {
  const { layerReorder } = header;
  if (isLayersCollapsed) {
    return (
      <div ref={arrangementLanesRef} className="arrangement-lanes">
        <section
          aria-label="Layers"
          className="layers-header"
          data-theme="dark"
        >
          <div className="track-label track-label--header">
            <button
              aria-expanded="false"
              className="layers-header__toggle"
              onClick={() => setLayersCollapsed(false)}
              title={layersToggleLabel(true)}
              type="button"
            >
              <ChevronDownIcon aria-hidden="true" />
              <span className="layers-header__title">
                <span>Layers</span>
                <small>{pluralize(lanes.length, "layer")} in session</small>
              </span>
            </button>
          </div>
          <div className="layers-header__content">
            <span className="layers-header__summary">
              {pluralize(lanes.length, "layer")} hidden
            </span>
          </div>
        </section>
      </div>
    );
  }
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
        const height = getRowHeight(rowHeights, "lane", lane.id);
        return (
          <section
            key={lane.id}
            className={`track-row ${lane.id === fxLaneId ? "track-row--selected" : ""} ${
              lane.id === layerReorder.liftedLaneId ? "track-row--lifted" : ""
            } ${getRowSizeClassName(height, DEFAULT_ROW_METRICS.lane.height)}`}
            data-layer-row-id={lane.id}
            style={getRowHeightStyle("lane", height)}
          >
            <LayerHeader
              lane={lane}
              laneIndex={laneIndex}
              fxLaneId={fxLaneId}
              status={laneStatusById.get(lane.id)}
              height={height}
              expandedHeight={getRowExpandedHeight(rowHeights, "lane", lane.id)}
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
