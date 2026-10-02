import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  classifySpaceTarget,
  createSpaceHold,
  isTextEntryTarget,
} from "./space-shortcut.ts";

const appTsx = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const useSpacePlaybackTs = readFileSync(
  new URL("./shortcuts/useSpacePlayback.ts", import.meta.url),
  "utf8",
);
const useRulerGesturesTs = readFileSync(
  new URL("./hooks/useRulerGestures.ts", import.meta.url),
  "utf8",
);

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

  it("leaves Space to playback while a docked listbox is on the page", () => {
    // Matches only an unqualified listbox selector, as a docked one would.
    const dockedListbox = {
      querySelector: (selector: string) =>
        selector.split(",").some((part) => part.trim() === '[role="listbox"]')
          ? {}
          : null,
    };
    assert.equal(
      classifySpaceTarget(element("BODY"), dockedListbox),
      "playback",
    );
  });

  it("lets a layer's or source track's reorder grip pick up and drop with Space", () => {
    assert.equal(
      classifySpaceTarget(
        element("BUTTON", { ancestors: ["[data-layer-grip]"] }),
        noOverlay,
      ),
      "grip",
    );
    assert.equal(
      classifySpaceTarget(
        element("BUTTON", { ancestors: ["[data-source-track-grip]"] }),
        noOverlay,
      ),
      "grip",
    );
  });

  it("lets the placeholder rows' add buttons activate with Space", () => {
    assert.equal(
      classifySpaceTarget(
        element("BUTTON", { ancestors: ["[data-space-activates]"] }),
        noOverlay,
      ),
      "button",
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
      useSpacePlaybackTs,
      /window\.addEventListener\("keydown", onSpaceKeyDown, true\)/,
    );
    assert.match(
      useSpacePlaybackTs,
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

  it("ignores releases without a press and canceled holds", () => {
    const hold = createSpaceHold();
    hold.markPanned();
    assert.equal(hold.release(), false);
    hold.press();
    hold.cancel();
    assert.equal(hold.held, false);
    assert.equal(hold.release(), false);
  });

  it("toggles playback on keyup and pans on Space + left-drag", () => {
    assert.match(useSpacePlaybackTs, /spaceHold\.release\(\)/);
    assert.match(
      useRulerGesturesTs,
      /isTimelinePanPress\(event, spaceHoldRef\.current\.held\)/,
    );
  });
});
