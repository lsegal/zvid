import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  classifySpaceTarget,
  createSpaceHold,
  isTextEntryTarget,
  isTimelinePanPress,
} from "./space-shortcut.ts";

const appTsx = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

function element(
  tagName: string,
  options: {
    type?: string;
    isContentEditable?: boolean;
    ancestors?: string[];
  } = {},
) {
  return {
    tagName,
    type: options.type,
    isContentEditable: options.isContentEditable ?? false,
    closest: (selector: string) =>
      (options.ancestors ?? []).some((ancestor) => selector.includes(ancestor))
        ? {}
        : null,
  };
}

const noOverlay = { querySelector: () => null };
const openOverlay = { querySelector: () => ({}) };

describe("space shortcut target classification", () => {
  it("keeps Space for text entry", () => {
    for (const type of ["text", "search", "number", "url", "email", ""]) {
      assert.equal(
        classifySpaceTarget(element("INPUT", { type }), noOverlay),
        "text-entry",
        `input type="${type}"`,
      );
    }
    assert.equal(
      classifySpaceTarget(element("TEXTAREA"), noOverlay),
      "text-entry",
    );
    assert.equal(
      classifySpaceTarget(
        element("DIV", { isContentEditable: true }),
        noOverlay,
      ),
      "text-entry",
    );
  });

  it("toggles playback from non-text controls", () => {
    for (const type of ["range", "checkbox", "radio", "button", "color"]) {
      assert.equal(
        classifySpaceTarget(element("INPUT", { type }), noOverlay),
        "playback",
        `input type="${type}"`,
      );
      assert.equal(isTextEntryTarget(element("INPUT", { type })), false);
    }
    assert.equal(classifySpaceTarget(element("BUTTON"), noOverlay), "playback");
    assert.equal(classifySpaceTarget(element("SELECT"), noOverlay), "playback");
    assert.equal(classifySpaceTarget(element("BODY"), noOverlay), "playback");
    assert.equal(classifySpaceTarget(null, noOverlay), "playback");
    assert.equal(classifySpaceTarget(element("BUTTON")), "playback");
  });

  it("lets open menus and dialogs handle Space", () => {
    assert.equal(
      classifySpaceTarget(
        element("DIV", { ancestors: ['[role="menu"]'] }),
        noOverlay,
      ),
      "overlay",
    );
    assert.equal(
      classifySpaceTarget(
        element("BUTTON", { ancestors: ['[role="dialog"]'] }),
        noOverlay,
      ),
      "overlay",
    );
    assert.equal(
      classifySpaceTarget(element("BUTTON"), openOverlay),
      "overlay",
    );
  });

  it("still types into text fields inside a dialog", () => {
    assert.equal(
      classifySpaceTarget(
        element("INPUT", { type: "text", ancestors: ['[role="dialog"]'] }),
        openOverlay,
      ),
      "text-entry",
    );
  });

  it("handles Space in the capture phase without per-control opt-outs", () => {
    assert.doesNotMatch(appTsx, /data-space-activates/);
    assert.match(
      appTsx,
      /window\.addEventListener\("keydown", onSpaceKeyDown, true\)/,
    );
    assert.match(
      appTsx,
      /window\.addEventListener\("keyup", onSpaceKeyUp, true\)/,
    );
  });
});

describe("space hold for hand-grab panning", () => {
  it("toggles playback on release when Space was not used to pan", () => {
    const hold = createSpaceHold();
    hold.press();
    assert.equal(hold.held, true);
    // Key repeat keeps the same hold.
    hold.press();
    assert.equal(hold.release(), true);
    assert.equal(hold.held, false);
  });

  it("does not toggle playback when Space was held for a pan", () => {
    const hold = createSpaceHold();
    hold.press();
    hold.markPanned();
    hold.press();
    assert.equal(hold.release(), false);

    // The next plain tap toggles again.
    hold.press();
    assert.equal(hold.release(), true);
  });

  it("ignores releases without a press and cancelled holds", () => {
    const hold = createSpaceHold();
    hold.markPanned();
    assert.equal(hold.release(), false);
    hold.press();
    hold.cancel();
    assert.equal(hold.held, false);
    assert.equal(hold.release(), false);
  });

  it("pans on a middle press, or a left press while Space is held", () => {
    assert.equal(isTimelinePanPress({ button: 1 }, false), true);
    assert.equal(isTimelinePanPress({ button: 1 }, true), true);
    assert.equal(isTimelinePanPress({ button: 0 }, true), true);
    assert.equal(isTimelinePanPress({ button: 0 }, false), false);
    assert.equal(isTimelinePanPress({ button: 2 }, true), false);
  });

  it("toggles playback on keyup and pans the timeline scroller", () => {
    assert.match(appTsx, /spaceHold\.release\(\)/);
    assert.match(appTsx, /useDragScroll\(timelineScrollRef, \{/);
    assert.match(
      appTsx,
      /isTimelinePanPress\(event, spaceHoldRef\.current\.held\)/,
    );
  });
});
