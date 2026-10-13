import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IDENTITY_TRANSFORM,
  type LayerTransform,
} from "../../../composition-transform.ts";
import { type LayerMove, parseLayerMove } from "./move.ts";
import {
  appendMoveWaypoint,
  clampMovePoint,
  insertMoveWaypoint,
  movePointParameters,
  movePoints,
  removeMoveWaypoint,
} from "./move-edit.ts";

function at(positionX: number, positionY = 0): LayerTransform {
  return { ...IDENTITY_TRANSFORM, positionX, positionY };
}

function applied(move: LayerMove, values: Record<string, number | string>) {
  const parameters = [
    ["Motion", move.motion],
    ["Path", move.path ?? "Lines"],
    ...Object.entries(
      Object.assign(
        movePointParameters("start", move.start),
        movePointParameters("end", move.end),
        ...(move.waypoints ?? []).map((waypoint, index) =>
          movePointParameters(index + 1, waypoint),
        ),
        { Waypoints: String(move.waypoints?.length ?? 0) },
        values,
      ),
    ),
  ];
  return parseLayerMove(
    parameters.map(([key, value]) => ({
      key: String(key),
      value: String(value),
    })),
  );
}

const MOVE: LayerMove = {
  start: at(-0.4),
  end: at(0.4),
  waypoints: [at(0, -0.2)],
  motion: "Ease In Out",
  path: "Lines",
};

describe("Move waypoint edits", () => {
  it("inserts a waypoint on the path between its neighbors", () => {
    // Three quarters along is halfway down the second leg.
    const inserted = insertMoveWaypoint(MOVE, 0.75);
    assert.equal(inserted?.point, 2);
    const next = applied(MOVE, inserted?.parameters ?? {});
    assert.deepEqual(
      next.waypoints?.map((point) => [point.positionX, point.positionY]),
      [
        [0, -0.2],
        [0.2, -0.1],
      ],
    );

    const first = insertMoveWaypoint(MOVE, 0.1);
    assert.equal(first?.point, 1);
    // A tenth of the way along is a fifth of the way down the first leg.
    assert.deepEqual(
      applied(MOVE, first?.parameters ?? {}).waypoints?.map((point) =>
        Number(point.positionX.toFixed(9)),
      ),
      [-0.32, 0],
    );
  });

  it("follows the path's shape, not the Motion curve's timing", () => {
    const inserted = insertMoveWaypoint(
      { start: at(0), end: at(1), motion: "Ease In" },
      0.5,
    );
    assert.equal(inserted?.parameters.Point1PositionX, 0.5);
  });

  it("appends a waypoint halfway along the last leg", () => {
    const appended = appendMoveWaypoint(MOVE);
    assert.equal(appended?.point, 2);
    assert.equal(appended?.parameters.Point2PositionX, 0.2);
  });

  it("adds no waypoint past the limit", () => {
    const full = { ...MOVE, waypoints: [at(0), at(0), at(0), at(0)] };
    assert.equal(insertMoveWaypoint(full, 0.5), undefined);
  });

  it("removes a waypoint, closing the path up around it", () => {
    const move = { ...MOVE, waypoints: [at(-0.2), at(0), at(0.2)] };
    const next = applied(move, removeMoveWaypoint(move, 2));
    assert.deepEqual(
      next.waypoints?.map((point) => point.positionX),
      [-0.2, 0.2],
    );
  });

  it("with no waypoints left, runs straight from Start to End", () => {
    const next = applied(MOVE, removeMoveWaypoint(MOVE, 1));
    assert.deepEqual(next.waypoints, []);
  });
});

describe("Move points", () => {
  it("lists Start, each waypoint, then End", () => {
    assert.deepEqual(movePoints(2), ["start", 1, 2, "end"]);
  });

  it("keeps a selected waypoint among those set", () => {
    assert.equal(clampMovePoint(3, 2), 2);
    assert.equal(clampMovePoint(1, 0), "start");
    assert.equal(clampMovePoint("end", 0), "end");
  });
});
