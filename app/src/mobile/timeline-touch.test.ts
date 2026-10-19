import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContextMenuEntry } from "../context-menu.ts";
import { ZOOM_MAX, ZOOM_MIN } from "../zoom.ts";
import {
  centeredScrollLeft,
  centerPlayheadQ,
  DOUBLE_TAP_MS,
  DOUBLE_TAP_SLOP_PX,
  exceedsTouchSlop,
  FLING_DECELERATION,
  flingStep,
  flingVelocity,
  isDoubleTap,
  isTouchTap,
  LONG_PRESS_MS,
  pickMenuItems,
  pinchZoom,
  playheadLoopRange,
  playheadScrollLeft,
  quickLoopRegion,
  swipePlayheadQ,
  TOUCH_SLOP_PX,
} from "./timeline-touch.ts";

// A phone: 112px labels in a 390px view, so the center is 83px past time 0.
const geometry = { labelWidth: 112, quarterPx: 40, clientWidth: 390 };

describe("center playhead", () => {
  it("keeps the timeline at its start until the playhead reaches the center", () => {
    assert.equal(centeredScrollLeft(0, geometry), 0);
    assert.equal(centeredScrollLeft(2, geometry), 0);
    assert.equal(playheadScrollLeft(0, geometry), -83);
    assert.equal(centeredScrollLeft(3, geometry), 37);
  });

  it("round-trips between scroll and time", () => {
    for (const q of [0, 0.5, 3, 17.25]) {
      const left = playheadScrollLeft(q, geometry);
      assert.equal(left, q * geometry.quarterPx - 83);
      assert.equal(centerPlayheadQ(left, geometry), q);
    }
  });

  it("never reads a time before 0", () => {
    assert.equal(centerPlayheadQ(-200, geometry), 0);
    assert.equal(centerPlayheadQ(10, { ...geometry, quarterPx: 0 }), 0);
  });
});

describe("swipePlayheadQ", () => {
  it("moves the playhead from time 0 toward the center, then scrolls", () => {
    // A swipe left moves forward in time, a pixel per pixel.
    assert.equal(swipePlayheadQ(0, -40, 1000, geometry), 1);
    assert.equal(swipePlayheadQ(0, -83, 1000, geometry), 83 / 40);
    assert.equal(swipePlayheadQ(0, -163, 1000, geometry), 163 / 40);
  });

  it("swipes back to time 0 and no further", () => {
    assert.equal(swipePlayheadQ(1, 40, 1000, geometry), 0);
    assert.equal(swipePlayheadQ(1, 400, 1000, geometry), 0);
  });

  it("stops where the timeline can't scroll any further", () => {
    assert.equal(swipePlayheadQ(0, -2000, 117, geometry), 200 / 40);
  });
});

describe("flingVelocity", () => {
  it("measures the finger's last 100ms", () => {
    const samples = [
      { x: 0, timeMs: 0 },
      { x: 100, timeMs: 100 },
      { x: 150, timeMs: 150 },
      { x: 250, timeMs: 200 },
    ];
    assert.equal(flingVelocity(samples), 1.5);
    assert.equal(
      flingVelocity(samples.map(({ x, timeMs }) => ({ x: -x, timeMs }))),
      -1.5,
    );
  });

  it("is 0 once the finger stopped or barely moved", () => {
    assert.equal(flingVelocity([]), 0);
    assert.equal(flingVelocity([{ x: 40, timeMs: 10 }]), 0);
    assert.equal(
      flingVelocity([
        { x: 0, timeMs: 0 },
        { x: 80, timeMs: 50 },
        { x: 80, timeMs: 300 },
      ]),
      0,
    );
  });
});

describe("flingStep", () => {
  it("slows at the scroll deceleration, in the fling's direction", () => {
    const step = flingStep(2, 16);
    assert.ok(Math.abs(step.velocity - 2 * FLING_DECELERATION ** 16) < 1e-9);
    assert.ok(step.distance > 31 && step.distance < 32);
    assert.ok(flingStep(-2, 16).distance < 0);
  });

  it("goes as far in many short frames as in one long one", () => {
    let velocity = 1;
    let distance = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      const step = flingStep(velocity, 1000 / 60);
      distance += step.distance;
      velocity = step.velocity;
    }
    assert.ok(Math.abs(distance - flingStep(1, 1000).distance) < 1e-6);
  });
});

describe("pinchZoom", () => {
  it("scales the zoom with the finger distance", () => {
    assert.equal(pinchZoom(1, 100, 150), 1.5);
    assert.equal(pinchZoom(1, 100, 50), 0.5);
  });

  it("stays within the zoom range", () => {
    assert.equal(pinchZoom(1, 10, 1000), ZOOM_MAX);
    assert.equal(pinchZoom(1, 1000, 10), ZOOM_MIN);
  });

  it("keeps the zoom when a distance is missing", () => {
    assert.equal(pinchZoom(1.25, 0, 40), 1.25);
  });
});

describe("exceedsTouchSlop", () => {
  it("treats small wobbles as holding still", () => {
    assert.equal(exceedsTouchSlop(3, 4), false);
    assert.equal(exceedsTouchSlop(TOUCH_SLOP_PX, 0), false);
    assert.equal(exceedsTouchSlop(TOUCH_SLOP_PX + 1, 0), true);
  });
});

describe("isTouchTap", () => {
  it("counts quick, still touches only", () => {
    assert.equal(isTouchTap(3, 4, 120), true);
    assert.equal(isTouchTap(TOUCH_SLOP_PX + 1, 0, 120), false);
    // A hold that started a selection or picked up a clip is no tap.
    assert.equal(isTouchTap(0, 0, LONG_PRESS_MS), false);
  });
});

describe("isDoubleTap", () => {
  const first = { x: 100, y: 50, timeMs: 1000 };

  it("needs a tap before it", () => {
    assert.equal(isDoubleTap(null, first), false);
  });

  it("counts a second tap soon after and close by", () => {
    assert.equal(isDoubleTap(first, { x: 110, y: 55, timeMs: 1200 }), true);
    assert.equal(
      isDoubleTap(first, { x: 100, y: 50, timeMs: 1000 + DOUBLE_TAP_MS }),
      true,
    );
  });

  it("rejects a tap too late or too far away", () => {
    assert.equal(
      isDoubleTap(first, { x: 100, y: 50, timeMs: 1001 + DOUBLE_TAP_MS }),
      false,
    );
    assert.equal(
      isDoubleTap(first, {
        x: 101 + DOUBLE_TAP_SLOP_PX,
        y: 50,
        timeMs: 1100,
      }),
      false,
    );
  });
});

describe("pickMenuItems", () => {
  const entries: ContextMenuEntry[] = [
    { type: "item", id: "jump-to-start", label: "Jump to Start" },
    { type: "separator" },
    { type: "item", id: "duplicate", label: "Duplicate" },
    {
      type: "item",
      id: "more",
      label: "More",
      submenu: [{ type: "item", id: "split", label: "Split", disabled: true }],
    },
    { type: "item", id: "delete", label: "Delete" },
  ];

  it("returns the requested items in the requested order", () => {
    assert.deepEqual(
      pickMenuItems(entries, ["split", "duplicate", "delete"]).map(
        (item) => item.id,
      ),
      ["split", "duplicate", "delete"],
    );
  });

  it("keeps the menu's disabled state", () => {
    assert.equal(pickMenuItems(entries, ["split"])[0]?.disabled, true);
  });

  it("skips ids the menu doesn't have", () => {
    assert.deepEqual(pickMenuItems(entries, ["paste"]), []);
  });
});

describe("quickLoopRegion", () => {
  it("loops the selected clip", () => {
    assert.deepEqual(quickLoopRegion(9, 4, { startQ: 2, endQ: 6 }), {
      startQ: 2,
      endQ: 6,
    });
  });

  it("prefers the first non-empty range, so a selection beats the clip", () => {
    const clip = { startQ: 2, endQ: 6 };
    assert.deepEqual(quickLoopRegion(9, 4, { startQ: 10, endQ: 11 }, clip), {
      startQ: 10,
      endQ: 11,
    });
    assert.deepEqual(
      quickLoopRegion(9, 4, undefined, { startQ: 3, endQ: 3 }, clip),
      clip,
    );
  });

  it("loops the playhead's bar without a clip", () => {
    assert.deepEqual(quickLoopRegion(9, 4), { startQ: 8, endQ: 12 });
    assert.deepEqual(quickLoopRegion(0, 3), { startQ: 0, endQ: 3 });
  });
});

describe("playheadLoopRange", () => {
  it("starts a bar at the playhead, snapped to the grid", () => {
    assert.deepEqual(playheadLoopRange(9.3, 4, 0.5, true), {
      startQ: 9.5,
      endQ: 13.5,
    });
    assert.deepEqual(playheadLoopRange(9.2, 3, 0.5, true), {
      startQ: 9,
      endQ: 12,
    });
  });

  it("starts at the playhead itself with snapping off", () => {
    assert.deepEqual(playheadLoopRange(9.3, 4, 0.5, false), {
      startQ: 9.3,
      endQ: 13.3,
    });
  });

  it("never starts before 0", () => {
    assert.deepEqual(playheadLoopRange(-1, 4, 1, true), { startQ: 0, endQ: 4 });
  });
});
