import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  formatClipJumpShortcut,
  isClipJumpPress,
  revealScrollLeft,
} from "./clip-jump.ts";
import { isContextMenuPress } from "./context-menu.ts";

const clipCardTsx = readFileSync(
  new URL("./components/timeline/ClipCard.tsx", import.meta.url),
  "utf8",
);
const useClipDragTs = readFileSync(
  new URL("./hooks/useClipDrag.ts", import.meta.url),
  "utf8",
);
const usePlaybackTs = readFileSync(
  new URL("./hooks/usePlayback.ts", import.meta.url),
  "utf8",
);

const press = (
  extra: Partial<{ button: number; ctrlKey: boolean; metaKey: boolean }> = {},
) => ({ button: 0, ctrlKey: false, metaKey: false, ...extra });

describe("isClipJumpPress", () => {
  it("jumps on Ctrl+click off macOS and Cmd+click on macOS", () => {
    assert.equal(isClipJumpPress(press({ ctrlKey: true }), false), true);
    assert.equal(isClipJumpPress(press({ metaKey: true }), true), true);
  });

  it("leaves a plain click alone", () => {
    assert.equal(isClipJumpPress(press(), false), false);
    assert.equal(isClipJumpPress(press(), true), false);
  });

  it("keeps Ctrl+click on macOS for the context menu", () => {
    const ctrlClick = press({ ctrlKey: true });
    assert.equal(isClipJumpPress(ctrlClick, true), false);
    assert.equal(isContextMenuPress(ctrlClick, true), true);
  });

  it("ignores the Windows key and other buttons", () => {
    assert.equal(isClipJumpPress(press({ metaKey: true }), false), false);
    assert.equal(
      isClipJumpPress(press({ button: 1, ctrlKey: true }), false),
      false,
    );
    assert.equal(
      isClipJumpPress(press({ button: 2, metaKey: true }), true),
      false,
    );
  });

  it("labels the platform's modifier", () => {
    assert.equal(formatClipJumpShortcut(false), "Ctrl+click");
    assert.equal(formatClipJumpShortcut(true), "Cmd+click");
  });
});

describe("revealScrollLeft", () => {
  const view = {
    scrollLeft: 1000,
    viewportWidth: 1100,
    labelWidth: 100,
    maxScrollLeft: 5000,
  };

  it("leaves a visible target where it is", () => {
    assert.equal(revealScrollLeft({ ...view, targetPx: 1100 }), 1000);
    assert.equal(revealScrollLeft({ ...view, targetPx: 1600 }), 1000);
    assert.equal(revealScrollLeft({ ...view, targetPx: 2100 }), 1000);
  });

  it("scrolls a target behind the labels or left of the view into view with a margin", () => {
    // 10% of the 1000px lane area past the labels.
    assert.equal(revealScrollLeft({ ...view, targetPx: 1050 }), 850);
    assert.equal(revealScrollLeft({ ...view, targetPx: 400 }), 200);
  });

  it("scrolls a target right of the view into view with a margin", () => {
    assert.equal(revealScrollLeft({ ...view, targetPx: 3000 }), 2800);
  });

  it("clamps to the scroll range", () => {
    assert.equal(revealScrollLeft({ ...view, targetPx: 150 }), 0);
    assert.equal(revealScrollLeft({ ...view, targetPx: 9000 }), 5000);
  });
});

describe("arrangement clip Ctrl/Cmd-click", () => {
  it("records the jump on the press that starts a Ctrl/Cmd-drag", () => {
    assert.match(
      clipCardTsx,
      /duplicateOnDrag,\s*jumpOnClick: isClipJumpPress\(\s*event,\s*shortcutLabels\.mac,?\s*\),/,
    );
  });

  it("jumps only when the press is released without dragging", () => {
    assert.match(
      useClipDragTs,
      /dragState\.duplicateOnDrag &&\s*!dragPreviewClips\s*\) \{\s*setSelectedClipId\(dragState\.sourceClipId\);[^}]*if \(\s*dragState\.jumpOnClick &&\s*Math\.abs\(event\.clientX - dragState\.pointerStartX\) <=\s*LANE_SELECTION_DRAG_THRESHOLD_PX\s*\) \{\s*jumpToClipStart\(dragState\.sourceClipId\);/,
    );
  });

  it("restarts playback from the clip start while playing", () => {
    const moveTo = usePlaybackTs.slice(
      usePlaybackTs.indexOf("const jumpPlayheadTo = useCallback("),
      usePlaybackTs.indexOf("const jumpToClipStart = useCallback("),
    );
    assert.match(
      moveTo,
      /setPlayheadQ\(startQ\);\s*playbackOriginRef\.current = startQ;\s*if \(isPlaying\) \{[^}]*flushSync\(\(\) => setIsPlaying\(false\)\);\s*startPlayback\(startQ\);/,
    );
    assert.match(moveTo, /revealScrollLeft\(/);
    const jump = usePlaybackTs.slice(
      usePlaybackTs.indexOf("const jumpToClipStart = useCallback("),
      usePlaybackTs.indexOf("const stopTimelineAudibleScrub = useCallback("),
    );
    assert.match(
      jump,
      /setSelectedClipId\(clip\.id\);\s*jumpPlayheadTo\(clip\.startQ\);/,
    );
  });

  it("names the shortcut in the clip tooltip", () => {
    assert.match(
      clipCardTsx,
      /title=\{`\$\{shortcutLabels\.clipJump\} to jump to start`\}/,
    );
  });
});
