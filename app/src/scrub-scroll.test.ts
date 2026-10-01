import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scrubScrollLeft } from "./scrub-scroll.ts";

const view = { viewportWidth: 1000, labelWidth: 200, maxScrollLeft: 3000 };

describe("scrubScrollLeft", () => {
  it("stays at 0 when the pointer goes left of 00:00:00 with the view at 0", () => {
    for (const pointerX of [180, 100, 0, -300]) {
      assert.equal(
        scrubScrollLeft({
          ...view,
          playheadPx: 200,
          pointerX,
          deltaX: -20,
          scrollLeft: 0,
        }),
        0,
      );
    }
  });

  it("only scrolls left while dragging far left past 0, ending at 0", () => {
    let scrollLeft = 400;
    // The pointer moves left from the lanes over the labels and past the
    // viewport while the playhead runs down to 0.
    const steps = [
      { playheadPx: 700, pointerX: 300 },
      { playheadPx: 450, pointerX: 210 },
      { playheadPx: 260, pointerX: 120 },
      { playheadPx: 200, pointerX: 40 },
      { playheadPx: 200, pointerX: -100 },
    ];
    for (const step of steps) {
      const next = scrubScrollLeft({
        ...view,
        ...step,
        deltaX: -50,
        scrollLeft,
      });
      assert.ok(next <= scrollLeft, `${next} > ${scrollLeft}`);
      scrollLeft = next;
    }
    assert.equal(scrollLeft, 0);
  });

  it("never scrolls left while dragging right", () => {
    assert.equal(
      scrubScrollLeft({
        ...view,
        playheadPx: 200,
        pointerX: 50,
        deltaX: 30,
        scrollLeft: 120,
      }),
      120,
    );
  });

  it("stops at maxScrollLeft past the end without overshooting", () => {
    let scrollLeft = 2900;
    for (const pointerX of [1000, 1100, 1400]) {
      scrollLeft = scrubScrollLeft({
        ...view,
        playheadPx: 4000,
        pointerX,
        deltaX: 100,
        scrollLeft,
      });
      assert.equal(scrollLeft, 3000);
    }
    // Wiggling back past the end doesn't jitter the view.
    assert.equal(
      scrubScrollLeft({
        ...view,
        playheadPx: 4000,
        pointerX: 1300,
        deltaX: -100,
        scrollLeft,
      }),
      3000,
    );
  });

  it("keeps the playhead under the pointer mid-timeline", () => {
    assert.equal(
      scrubScrollLeft({
        ...view,
        playheadPx: 1500,
        pointerX: 600,
        deltaX: 40,
        scrollLeft: 860,
      }),
      900,
    );
    assert.equal(
      scrubScrollLeft({
        ...view,
        playheadPx: 1500,
        pointerX: 600,
        deltaX: -40,
        scrollLeft: 940,
      }),
      900,
    );
  });

  it("leaves the view put when the pointer doesn't move horizontally", () => {
    assert.equal(
      scrubScrollLeft({
        ...view,
        playheadPx: 1500,
        pointerX: 600,
        deltaX: 0,
        scrollLeft: 870,
      }),
      870,
    );
  });
});
