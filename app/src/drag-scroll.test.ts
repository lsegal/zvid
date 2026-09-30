import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  DRAG_SCROLL_THRESHOLD_PX,
  dragScrollPosition,
  exceedsDragThreshold,
  isRulerPanPress,
  isTimelinePanPress,
  releaseVelocity,
  stepMomentum,
} from "./drag-scroll.ts";

const appTsx = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const useRulerGesturesTs = readFileSync(
  new URL("./hooks/useRulerGestures.ts", import.meta.url),
  "utf8",
);
const usePlaybackTs = readFileSync(
  new URL("./hooks/usePlayback.ts", import.meta.url),
  "utf8",
);

describe("ruler pan presses", () => {
  it("pans on the right and middle buttons but not the left", () => {
    assert.equal(isRulerPanPress({ button: 2, ctrlKey: false }, false), true);
    assert.equal(isRulerPanPress({ button: 1, ctrlKey: false }, false), true);
    assert.equal(isRulerPanPress({ button: 0, ctrlKey: false }, false), false);
    assert.equal(isRulerPanPress({ button: 0, ctrlKey: false }, true), false);
  });

  it("treats Ctrl-click as a right-click only on macOS", () => {
    assert.equal(isRulerPanPress({ button: 0, ctrlKey: true }, true), true);
    assert.equal(isRulerPanPress({ button: 0, ctrlKey: true }, false), false);
  });
});

describe("timeline pan presses", () => {
  it("pans on the middle button, or the left button while Space is held", () => {
    assert.equal(isTimelinePanPress({ button: 1 }, false), true);
    assert.equal(isTimelinePanPress({ button: 1 }, true), true);
    assert.equal(isTimelinePanPress({ button: 0 }, true), true);
    assert.equal(isTimelinePanPress({ button: 0 }, false), false);
    assert.equal(isTimelinePanPress({ button: 2 }, true), false);
  });
});

describe("drag threshold", () => {
  it("starts a pan only past the threshold", () => {
    assert.equal(exceedsDragThreshold(DRAG_SCROLL_THRESHOLD_PX, 0, "x"), false);
    assert.equal(
      exceedsDragThreshold(DRAG_SCROLL_THRESHOLD_PX + 1, 0, "x"),
      true,
    );
  });

  it("ignores movement off a horizontal axis", () => {
    assert.equal(exceedsDragThreshold(0, 40, "x"), false);
    assert.equal(exceedsDragThreshold(0, 40, "both"), true);
    assert.equal(exceedsDragThreshold(3, 3, "both"), true);
  });
});

describe("drag scroll position", () => {
  it("moves the content with the pointer 1:1", () => {
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

describe("drag scroll momentum", () => {
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

  it("stops dead when the pointer paused before release", () => {
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
  });

  it("decays until it stops", () => {
    let velocity = { x: 2, y: 0 };
    let travelled = 0;
    let frames = 0;
    for (;;) {
      const step = stepMomentum(velocity, 16);
      if (!step) {
        break;
      }
      assert.ok(Math.abs(step.velocity.x) < Math.abs(velocity.x));
      travelled += step.dx;
      velocity = step.velocity;
      frames += 1;
      assert.ok(frames < 1000);
    }
    assert.ok(travelled > 0);
    assert.equal(stepMomentum({ x: 0, y: 0 }, 16), null);
  });
});

describe("timeline ruler", () => {
  it("pans through useDragScroll and never shows the browser menu", () => {
    assert.match(
      useRulerGesturesTs,
      /useDragScroll\(\{\s*scrollRef: timelineScrollRef,/,
    );
    assert.match(
      appTsx,
      /\{\.\.\.rulerDragScroll\.handlers\}\s*onContextMenu=\{\(event\) => \{[^}]*event\.preventDefault\(\);/,
    );
  });

  it("only scrubs the playhead with the primary button", () => {
    assert.match(
      appTsx,
      /event\.button !== 0 \|\|\s*isRulerPanPress\(event, shortcutLabels\.mac\)/,
    );
  });

  it("zooms on a right-drag and commits the zoom when it ends", () => {
    assert.match(
      useRulerGesturesTs,
      /useDragScroll\(\{\s*scrollRef: timelineScrollRef,\s*canStart: canStartRulerPan,[^}]*thresholdAxis: "both",\s*onDrag: dragRuler,\s*onEnd: endRulerPan,/,
    );
    assert.match(
      useRulerGesturesTs,
      /rulerZoomRef\.current = isContextMenuPress\(event, shortcutLabels\.mac\)/,
    );
    assert.match(
      useRulerGesturesTs,
      /const endRulerPan = useCallback\(\(\) => \{[^}]*\}\s*rulerZoomRef\.current = null;\s*rulerZoomScrollRef\.current = null;\s*flushZoomDraft\(\);/,
    );
  });

  it("never zooms while scrubbing with the left button", () => {
    const scrub = usePlaybackTs.slice(
      usePlaybackTs.indexOf("if (!timelineDragState) {"),
      usePlaybackTs.indexOf(
        "}, [",
        usePlaybackTs.indexOf("if (!timelineDragState) {"),
      ),
    );
    assert.ok(scrub.includes("timelineDragState.originZoom"));
    assert.doesNotMatch(scrub, /updateZoomDraft|flushZoomDraft|clientY/);
  });
});

describe("timeline pan", () => {
  it("claims presses before lane, clip and ruler handlers see them", () => {
    assert.match(
      useRulerGesturesTs,
      /useDragScroll\(\{\s*scrollRef: timelineScrollRef,\s*canStart: canStartTimelinePan,\s*axis: "both",[^}]*capture: true,/,
    );
    assert.match(
      appTsx,
      /className=\{`timeline-scroll [^`]*`\}\s*\{\.\.\.timelineDragScroll\.handlers\}/,
    );
  });
});
