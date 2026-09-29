import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DRAG_SCROLL_MOMENTUM_MS,
  DRAG_SCROLL_THRESHOLD_PX,
  dragScrollPosition,
  exceedsDragThreshold,
  momentumOffset,
  releaseVelocity,
} from "./drag-scroll.ts";

describe("drag threshold", () => {
  it("starts a pan only past the threshold", () => {
    assert.equal(exceedsDragThreshold(DRAG_SCROLL_THRESHOLD_PX, 0, "x"), false);
    assert.equal(exceedsDragThreshold(-3, 0, "x"), false);
    assert.equal(
      exceedsDragThreshold(DRAG_SCROLL_THRESHOLD_PX + 1, 0, "x"),
      true,
    );
    assert.equal(exceedsDragThreshold(-5, 0, "x"), true);
  });

  it("only counts movement along the axis", () => {
    assert.equal(exceedsDragThreshold(0, 40, "x"), false);
    assert.equal(exceedsDragThreshold(40, 0, "y"), false);
    assert.equal(exceedsDragThreshold(0, 40, "both"), true);
    assert.equal(exceedsDragThreshold(3, 3, "both"), true);
  });
});

describe("drag scroll position", () => {
  it("moves the content with the pointer 1:1 along the axis", () => {
    assert.deepEqual(
      dragScrollPosition({ left: 500, top: 20 }, -120, 30, "x"),
      { left: 620, top: 20 },
    );
    assert.deepEqual(
      dragScrollPosition({ left: 500, top: 20 }, 80, 30, "both"),
      { left: 420, top: -10 },
    );
  });
});

describe("release velocity", () => {
  it("carries on opposite to the pointer's recent movement", () => {
    const velocity = releaseVelocity(
      [
        { x: 0, y: 0, time: 0 },
        { x: 100, y: 0, time: 200 },
        { x: 150, y: 10, time: 250 },
      ],
      260,
      "x",
    );
    assert.deepEqual(velocity, { x: -1, y: 0 });
  });

  it("is zero when the pointer paused before release", () => {
    assert.deepEqual(
      releaseVelocity(
        [
          { x: 0, y: 0, time: 0 },
          { x: 100, y: 0, time: 50 },
        ],
        400,
        "x",
      ),
      { x: 0, y: 0 },
    );
    assert.deepEqual(releaseVelocity([], 0, "x"), { x: 0, y: 0 });
  });
});

describe("momentum", () => {
  it("decays to a stop over the momentum duration", () => {
    const velocity = { x: 2, y: 0 };
    assert.deepEqual(momentumOffset(velocity, 0), { x: 0, y: 0 });

    // Linear decay covers half the distance the initial speed would.
    const total = momentumOffset(velocity, DRAG_SCROLL_MOMENTUM_MS);
    assert.equal(total.x, DRAG_SCROLL_MOMENTUM_MS);
    assert.deepEqual(
      momentumOffset(velocity, DRAG_SCROLL_MOMENTUM_MS * 4),
      total,
    );

    let previous = 0;
    let previousStep = Number.POSITIVE_INFINITY;
    for (let time = 16; time <= DRAG_SCROLL_MOMENTUM_MS; time += 16) {
      const offset = momentumOffset(velocity, time).x;
      assert.ok(offset > previous);
      assert.ok(offset - previous < previousStep);
      previousStep = offset - previous;
      previous = offset;
    }
  });

  it("follows the velocity's direction", () => {
    const offset = momentumOffset({ x: -1, y: 0.5 }, 100, 200);
    assert.deepEqual(offset, { x: -75, y: 37.5 });
  });
});
