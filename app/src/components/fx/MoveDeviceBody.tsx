import {
  MOVE_WAYPOINT_LIMIT,
  parseLayerMove,
} from "../../fx/effects/move/move.ts";
import {
  appendMoveWaypoint,
  clampMovePoint,
  describeMovePoint,
  MOVE_WAYPOINTS_KEY,
  type MoveParameterValues,
  type MovePoint,
  removeMoveWaypoint,
} from "../../fx/effects/move/move-edit.ts";
import { useMovePointSelection } from "../../fx/effects/move/move-point-selection.ts";
import type { FxLayerOption } from "../../fx-chain";
import type { FxDevice, FxDeviceParameter } from "../../fx-stack";
import { FxParameterControl } from "./FxParameterControl";
import type { FxSetParameter } from "./types";
import "./move-device.css";

const CHIPS: MovePoint[] = [
  "start",
  ...Array.from({ length: MOVE_WAYPOINT_LIMIT }, (_, index) => index + 1),
  "end",
];

// A Move device's body: its Motion and Path, chips for its Start, waypoints
// and End, and one placement row for the selected point. A dimmed chip adds
// the next waypoint. The selected point is the one picked on the preview's
// motion path too.
export function MoveDeviceBody({
  device,
  controls,
  knobRows,
  layers,
  onSetParameter,
}: {
  device: FxDevice;
  controls: FxDeviceParameter[];
  // The placement rows: Start, each waypoint, then End.
  knobRows: { label: string; knobs: FxDeviceParameter[] }[];
  layers: readonly FxLayerOption[];
  onSetParameter: FxSetParameter;
}) {
  const selection = useMovePointSelection();
  const waypointCount = Math.max(0, knobRows.length - 2);
  const selected = clampMovePoint(selection.read(device.id), waypointCount);
  const rowIndex =
    selected === "start"
      ? 0
      : selected === "end"
        ? knobRows.length - 1
        : selected;
  const row = knobRows[rowIndex];
  const select = (point: MovePoint) => selection.select(device.id, point);
  // The Move as stored, from its knobs, which show every set point.
  const readMove = () =>
    parseLayerMove([
      { key: MOVE_WAYPOINTS_KEY, value: String(waypointCount) },
      ...knobRows.flatMap((candidate) =>
        candidate.knobs.map((knob) => ({
          key: knob.key,
          value: String(knob.numericValue ?? knob.defaultValue),
        })),
      ),
    ]);
  // Writes several parameters as one undo step.
  const write = (values: MoveParameterValues) => {
    const entries = Object.entries(values);
    entries.forEach(([key, value], index) => {
      onSetParameter(
        device,
        key,
        value,
        index === entries.length - 1 ? "commit" : "transient",
      );
    });
  };
  const addWaypoint = () => {
    const added = appendMoveWaypoint(readMove());
    if (added) {
      write(added.parameters);
      select(added.point);
    }
  };
  const removeSelected = () => {
    if (typeof selected === "number") {
      write(removeMoveWaypoint(readMove(), selected));
      select(selected > 1 ? selected - 1 : "start");
    }
  };

  return (
    <div
      className="fx-device-panel__body"
      style={{
        gridTemplateColumns: `auto repeat(${row?.knobs.length ?? 1}, auto)`,
      }}
    >
      {controls.map((parameter) => (
        <FxParameterControl
          key={parameter.key}
          device={device}
          layers={layers}
          onSetParameter={onSetParameter}
          parameter={parameter}
        />
      ))}
      <div
        className="fx-move-points"
        role="toolbar"
        aria-label={`${device.name} points`}
      >
        {CHIPS.map((point) => {
          const isSet = typeof point !== "number" || point <= waypointCount;
          const isNext = point === waypointCount + 1;
          const label = describeMovePoint(point);
          return (
            <button
              key={String(point)}
              type="button"
              className={`fx-move-points__chip${isSet ? "" : " fx-move-points__chip--unset"}`}
              aria-pressed={isSet ? point === selected : undefined}
              aria-label={isSet ? label : `Add ${label}`}
              title={
                isSet
                  ? `Edit the ${label} placement`
                  : isNext
                    ? `Add ${label}`
                    : `Add waypoints in order, ${describeMovePoint(waypointCount + 1)} next`
              }
              disabled={!isSet && !isNext}
              onClick={() => (isSet ? select(point) : addWaypoint())}
            >
              {point === "start" ? "Start" : point === "end" ? "End" : point}
            </button>
          );
        })}
        {typeof selected === "number" ? (
          <button
            type="button"
            className="fx-move-points__remove"
            aria-label={`Remove ${describeMovePoint(selected)}`}
            title={`Remove ${describeMovePoint(selected)}`}
            onClick={removeSelected}
          >
            Remove
          </button>
        ) : null}
      </div>
      {row ? (
        <fieldset className="fx-device-panel__knob-row">
          <legend className="fx-device-panel__row-label">{row.label}</legend>
          {row.knobs.map((parameter) => (
            <FxParameterControl
              key={parameter.key}
              device={device}
              layers={layers}
              onSetParameter={onSetParameter}
              parameter={parameter}
            />
          ))}
        </fieldset>
      ) : null}
    </div>
  );
}
