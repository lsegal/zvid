import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContextMenuEntry } from "../context-menu.ts";
import { ZOOM_MAX, ZOOM_MIN } from "../zoom.ts";
import {
  centeredScrollLeft,
  centerPlayheadQ,
  exceedsTouchSlop,
  pickMenuItems,
  pinchZoom,
  quickLoopRegion,
  TOUCH_SLOP_PX,
} from "./timeline-touch.ts";

const geometry = { labelWidth: 195, quarterPx: 40, clientWidth: 390 };

describe("center playhead", () => {
  it("puts time 0 at the center with half a view of lead-in", () => {
    assert.equal(centeredScrollLeft(0, geometry), 0);
    assert.equal(centerPlayheadQ(0, geometry), 0);
  });

  it("round-trips between scroll and time", () => {
    for (const q of [0.5, 3, 17.25]) {
      const left = centeredScrollLeft(q, geometry);
      assert.equal(left, q * geometry.quarterPx);
      assert.equal(centerPlayheadQ(left, geometry), q);
    }
  });

  it("never reads a time before 0", () => {
    assert.equal(centerPlayheadQ(0, { ...geometry, labelWidth: 300 }), 0);
    assert.equal(centerPlayheadQ(10, { ...geometry, quarterPx: 0 }), 0);
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

  it("loops the playhead's bar without a clip", () => {
    assert.deepEqual(quickLoopRegion(9, 4), { startQ: 8, endQ: 12 });
    assert.deepEqual(quickLoopRegion(0, 3), { startQ: 0, endQ: 3 });
  });
});
