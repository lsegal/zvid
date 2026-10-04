import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldReleaseFocus } from "./timeline-focus.ts";

const body = { contains: () => true };

function pressTarget(inTimeline: boolean) {
  return {
    closest: (selector: string) =>
      inTimeline && selector === ".timeline-panel" ? {} : null,
  };
}

function focused(...children: unknown[]) {
  return { contains: (other: unknown) => children.includes(other) };
}

describe("shouldReleaseFocus", () => {
  it("releases a control focused outside the press in the timeline", () => {
    const lane = pressTarget(true);
    assert.equal(shouldReleaseFocus(lane, focused(), body), true);
  });

  it("keeps the focus for a press inside the focused element", () => {
    const field = pressTarget(true);
    assert.equal(shouldReleaseFocus(field, focused(field), body), false);
  });

  it("ignores presses outside the timeline", () => {
    assert.equal(shouldReleaseFocus(pressTarget(false), focused(), body), false);
  });

  it("does nothing when nothing has the focus", () => {
    const lane = pressTarget(true);
    assert.equal(shouldReleaseFocus(lane, body, body), false);
    assert.equal(shouldReleaseFocus(lane, null, body), false);
  });

  it("ignores targets that are not elements", () => {
    assert.equal(shouldReleaseFocus(null, focused(), body), false);
    assert.equal(shouldReleaseFocus({}, focused(), body), false);
  });
});
