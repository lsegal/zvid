import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { classifySpaceTarget, isTextEntryTarget } from "./space-shortcut.ts";

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
    assert.equal(
      classifySpaceTarget(element("BUTTON"), noOverlay),
      "playback",
    );
    assert.equal(
      classifySpaceTarget(element("SELECT"), noOverlay),
      "playback",
    );
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
    assert.match(appTsx, /window\.addEventListener\("keyup", onSpaceKeyUp, true\)/);
  });
});
