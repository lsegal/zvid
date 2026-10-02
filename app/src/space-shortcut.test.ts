import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  classifySpaceTarget,
  createSpaceHold,
  hasOpenPopup,
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

const trackPlaceholderTsx = readFileSync(
  new URL("./components/timeline/TrackPlaceholder.tsx", import.meta.url),
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

describe("space shortcut target classification", () => {
  it("keeps Space for text entry", () => {
    for (const type of ["text", "search", "number", "url", "email", ""]) {
      assert.equal(
        classifySpaceTarget(element("INPUT", { type })),
        "text-entry",
        `input type="${type}"`,
      );
    }
    assert.equal(classifySpaceTarget(element("TEXTAREA")), "text-entry");
    assert.equal(
      classifySpaceTarget(element("DIV", { isContentEditable: true })),
      "text-entry",
    );
  });

  it("toggles playback from non-text controls", () => {
    for (const type of ["range", "checkbox", "radio", "button", "color"]) {
      assert.equal(
        classifySpaceTarget(element("INPUT", { type })),
        "playback",
        `input type="${type}"`,
      );
      assert.equal(isTextEntryTarget(element("INPUT", { type })), false);
    }
    assert.equal(classifySpaceTarget(element("BUTTON")), "playback");
    assert.equal(classifySpaceTarget(element("SELECT")), "playback");
    assert.equal(classifySpaceTarget(element("BODY")), "playback");
    assert.equal(classifySpaceTarget(null), "playback");
    assert.equal(classifySpaceTarget(element("BUTTON")), "playback");
  });

  it("toggles playback from menus, dialogs, grips and every button", () => {
    for (const ancestor of [
      '[role="menu"]',
      '[role="listbox"]',
      '[role="dialog"]',
      '[role="alertdialog"]',
      '[aria-modal="true"]',
      '[role="menubar"]',
      "[data-layer-grip]",
      "[data-source-track-grip]",
      "[data-space-activates]",
    ]) {
      assert.equal(
        classifySpaceTarget(element("BUTTON", { ancestors: [ancestor] })),
        "playback",
        ancestor,
      );
    }
  });

  it("leaves Space to a region that plays its own preview", () => {
    assert.equal(
      classifySpaceTarget(
        element("BUTTON", { ancestors: ["[data-space-playback]"] }),
      ),
      "own-playback",
    );
  });

  it("still types into text fields inside a dialog", () => {
    assert.equal(
      classifySpaceTarget(
        element("INPUT", {
          type: "text",
          ancestors: ['[role="dialog"]', "[data-space-playback]"],
        }),
      ),
      "text-entry",
    );
  });

  it("handles Space in the capture phase without per-control opt-outs", () => {
    assert.doesNotMatch(appTsx, /data-space-activates/);
    assert.doesNotMatch(trackPlaceholderTsx, /data-space-activates/);
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

describe("open popups that Space closes", () => {
  // Matches when any part of the selector list is one of `present`.
  const page = (...present: string[]) => ({
    querySelector: (selector: string) =>
      selector.split(",").some((part) => present.includes(part.trim()))
        ? {}
        : null,
  });

  it("finds open menus, listboxes and popovers", () => {
    assert.equal(hasOpenPopup(page('[role="menu"]')), true);
    assert.equal(
      hasOpenPopup(page('[role="listbox"]:not([data-docked-listbox])')),
      true,
    );
    assert.equal(
      hasOpenPopup(page("[data-radix-popper-content-wrapper]")),
      true,
    );
  });

  it("ignores docked listboxes, the menubar, dialogs and an empty page", () => {
    assert.equal(hasOpenPopup(page('[role="listbox"]')), false);
    assert.equal(hasOpenPopup(page('[role="menubar"]')), false);
    assert.equal(hasOpenPopup(page('[role="dialog"]')), false);
    assert.equal(hasOpenPopup(page()), false);
    assert.equal(hasOpenPopup(null), false);
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
