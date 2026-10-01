import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  clampTimeValue,
  formatTimeValue,
  moveTimeValueDrag,
  parseTimeValue,
  resolveTimeValueEdit,
  startTimeValueDrag,
  stepTimeValue,
  TIME_VALUE_DRAG_PIXELS_PER_STEP,
  type TimeValueDrag,
  type TimeValueFormat,
  timeValueDragChanged,
  timeValueForKey,
  timeValueStep,
} from "./time-value.ts";

const fourFour = { numerator: 4, denominator: 4 };
const musical: TimeValueFormat = {
  timelineMode: "musical",
  bpm: 120,
  signature: fourFour,
  fps: 30,
};
const timecode: TimeValueFormat = { ...musical, timelineMode: "timecode" };
// At 120 bpm a quarter note is half a second.
const range = { min: 0, max: 64 };

describe("formatTimeValue", () => {
  it("shows musical positions 1-based and durations 0-based", () => {
    assert.equal(formatTimeValue(0, "position", musical), "1.1.1");
    assert.equal(formatTimeValue(0, "duration", musical), "0.0.0");
    assert.equal(formatTimeValue(5.25, "position", musical), "2.2.2");
    assert.equal(formatTimeValue(5.25, "duration", musical), "1.1.1");
  });

  it("counts beats and sixteenths in the meter's beat unit", () => {
    const sixEight = { ...musical, signature: { numerator: 6, denominator: 8 } };
    // A 6/8 bar is three quarters; a beat is an eighth.
    assert.equal(formatTimeValue(3, "position", sixEight), "2.1.1");
    assert.equal(formatTimeValue(3.5, "duration", sixEight), "1.1.0");
  });

  it("shows timecode as mm:ss:ff for both kinds", () => {
    assert.equal(formatTimeValue(0, "position", timecode), "00:00:00");
    assert.equal(formatTimeValue(145, "position", timecode), "01:12:15");
    assert.equal(formatTimeValue(145, "duration", timecode), "01:12:15");
  });

  it("reads values a hair under a tick or frame as that tick or frame", () => {
    assert.equal(formatTimeValue(0.25 - 1e-9, "position", musical), "1.1.2");
    const oneFrame = 1 / 30 / 0.5;
    assert.equal(formatTimeValue(oneFrame - 1e-12, "duration", timecode), "00:00:01");
  });

  it("updates with the timeline mode", () => {
    assert.notEqual(
      formatTimeValue(8, "position", musical),
      formatTimeValue(8, "position", timecode),
    );
  });
});

describe("parseTimeValue", () => {
  it("round-trips formatted values in both modes and kinds", () => {
    // Timecode only shows whole frames (a fifteenth of a quarter here).
    const values = new Map([
      [musical, [0, 0.25, 3.75, 5.25, 17, 145]],
      [timecode, [0, 2 / 15, 1, 17, 145]],
    ]);
    for (const [format, quarters] of values) {
      for (const kind of ["position", "duration"] as const) {
        for (const value of quarters) {
          const text = formatTimeValue(value, kind, format);
          const parsed = parseTimeValue(text, kind, format);
          assert.ok(parsed !== null, `${text} parses`);
          assert.ok(Math.abs(parsed - value) < 1e-9, `${text} -> ${parsed}`);
        }
      }
    }
  });

  it("accepts partial musical positions and bare bars", () => {
    assert.equal(parseTimeValue("3.2", "position", musical), 9);
    assert.equal(parseTimeValue("3", "position", musical), 8);
    assert.equal(parseTimeValue(" 2 ", "duration", musical), 8);
    assert.equal(parseTimeValue("0.1", "duration", musical), 1);
  });

  it("accepts timecode shorthands and bare seconds", () => {
    // 1 minute 5 seconds at half a second per quarter.
    assert.equal(parseTimeValue("1:05", "position", timecode), 130);
    assert.equal(parseTimeValue("2.5", "duration", timecode), 5);
    assert.equal(parseTimeValue("0:00:15", "duration", timecode), 1);
    assert.equal(parseTimeValue("0:01:00:00", "duration", timecode), 120);
  });

  it("accepts colon timecode in musical mode", () => {
    assert.equal(parseTimeValue("1:05", "position", musical), 130);
  });

  it("rejects text that is not a time", () => {
    for (const text of ["", "  ", "abc", "-1", "1..2", "1.2.3.4", "0.1.1"]) {
      assert.equal(parseTimeValue(text, "position", musical), null, text);
    }
    for (const text of ["", "abc", "-2", "1:x", "1:2:3:4:5", "1.5:00"]) {
      assert.equal(parseTimeValue(text, "duration", timecode), null, text);
    }
  });
});

describe("clampTimeValue", () => {
  it("holds values inside [min, max]", () => {
    assert.equal(clampTimeValue(-3, range), 0);
    assert.equal(clampTimeValue(70, range), 64);
    assert.equal(clampTimeValue(12.5, range), 12.5);
  });
});

describe("timeValueStep", () => {
  it("steps a sixteenth or a beat in musical mode", () => {
    assert.equal(timeValueStep(musical), 0.25);
    assert.equal(timeValueStep(musical, true), 1);
  });

  it("steps a frame or a second in timecode mode", () => {
    assert.ok(Math.abs(timeValueStep(timecode) - 1 / 15) < 1e-12);
    assert.equal(timeValueStep(timecode, true), 2);
  });
});

describe("stepTimeValue", () => {
  it("moves by whole steps and clamps", () => {
    assert.equal(stepTimeValue(4, 1, musical, range), 4.25);
    assert.equal(stepTimeValue(4, -2, musical, range), 3.5);
    assert.equal(stepTimeValue(4, 3, musical, range, true), 7);
    assert.equal(stepTimeValue(63.9, 4, musical, range), 64);
    assert.equal(stepTimeValue(0.1, -4, musical, range), 0);
  });

  it("snaps an off-grid value to the next grid line in the step direction", () => {
    assert.equal(stepTimeValue(4.1, 1, musical, range), 4.25);
    assert.equal(stepTimeValue(4.1, -1, musical, range), 4);
  });
});

describe("timeValueForKey", () => {
  it("steps up and down with the arrow keys, coarse with Shift", () => {
    assert.equal(timeValueForKey("ArrowUp", false, 4, musical, range), 4.25);
    assert.equal(timeValueForKey("ArrowDown", false, 4, musical, range), 3.75);
    assert.equal(timeValueForKey("ArrowUp", true, 4, musical, range), 5);
    assert.equal(timeValueForKey("ArrowDown", false, 0, musical, range), 0);
    assert.equal(timeValueForKey("ArrowLeft", false, 4, musical, range), null);
  });
});

describe("resolveTimeValueEdit", () => {
  it("commits a valid draft on Enter or blur, clamped", () => {
    assert.deepEqual(
      resolveTimeValueEdit("enter", "3.2", "position", musical, range),
      { kind: "commit", value: 9 },
    );
    assert.deepEqual(
      resolveTimeValueEdit("blur", "99", "position", musical, range),
      { kind: "commit", value: 64 },
    );
  });

  it("reverts on Escape or invalid input", () => {
    assert.deepEqual(
      resolveTimeValueEdit("escape", "3.2", "position", musical, range),
      { kind: "revert" },
    );
    assert.deepEqual(
      resolveTimeValueEdit("enter", "nope", "position", musical, range),
      { kind: "revert" },
    );
  });
});

describe("time value drag", () => {
  const px = TIME_VALUE_DRAG_PIXELS_PER_STEP;
  const drag = (moves: number[], startValue = 4, coarse = false) =>
    moves.reduce<TimeValueDrag>(
      (state, y) => moveTimeValueDrag(state, y, coarse, musical, range),
      startTimeValueDrag(1, startValue, 100),
    );

  it("increases when dragged up and decreases when dragged down", () => {
    assert.equal(drag([100 - px]).value, 4.25);
    assert.equal(drag([100 - px * 4]).value, 5);
    assert.equal(drag([100 + px * 2]).value, 3.5);
    assert.equal(drag([100 - px * 2], 4, true).value, 6);
  });

  it("accumulates sub-step movement across events", () => {
    const moves = Array.from({ length: px }, (_, index) => 99 - index);
    assert.equal(drag(moves).value, 4.25);
    assert.equal(drag([100 - (px - 1)]).value, 4);
  });

  it("clamps at min and max and turns back immediately", () => {
    const atMax = drag([100 - px * 1000], 60);
    assert.equal(atMax.value, 64);
    assert.equal(drag([100 - px * 1000, 100 - px * 1001], 60).value, 64);
    assert.equal(drag([100 - px * 1000, 100 - px * 999], 60).value, 63.75);
    assert.equal(drag([100 + px * 1000]).value, 0);
  });

  it("commits on release only when the value changed", () => {
    assert.equal(timeValueDragChanged(drag([100 - px])), true);
    assert.equal(timeValueDragChanged(drag([100 - px, 100])), false);
    assert.equal(timeValueDragChanged(drag([100 - 1])), false);
  });
});

describe("TimeValueControl", () => {
  const source = readFileSync(
    new URL("./components/ui/TimeValueControl.tsx", import.meta.url),
    "utf8",
  );
  const css = readFileSync(
    new URL("./components/ui/time-value-control.css", import.meta.url),
    "utf8",
  );

  it("is a spinbutton with its range and formatted value", () => {
    assert.match(source, /role="spinbutton"/);
    for (const attribute of [
      "aria-valuemin",
      "aria-valuemax",
      "aria-valuenow",
      "aria-valuetext",
    ]) {
      assert.match(source, new RegExp(`${attribute}=`), attribute);
    }
  });

  it("drags from an ns-resize handle with pointer capture", () => {
    assert.match(css, /\.time-value__handle \{[^}]*cursor: ns-resize;/);
    assert.match(source, /setPointerCapture\(event\.pointerId\)/);
    assert.match(source, /onLostPointerCapture=\{endDrag\}/);
  });

  it("emits live changes and a single commit per gesture", () => {
    assert.match(source, /onChange\(next, \{ commit: false \}\)/);
    assert.match(source, /onChange\(currentRef\.current, \{ commit: true \}\)/);
    assert.match(source, /onKeyUp=\{flushCommit\}/);
  });
});
