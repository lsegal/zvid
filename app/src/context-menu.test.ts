import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type ContextMenuEntry,
  firstEnabledIndex,
  getLevelEntries,
  handleMenuKey,
  hoverMenuPath,
  isContextMenuKey,
  MENU_VIEWPORT_MARGIN,
  placeContextMenu,
  placeSubmenu,
  stepEnabledIndex,
} from "./context-menu.ts";

const item = (
  id: string,
  extra: Partial<Extract<ContextMenuEntry, { type: "item" }>> = {},
): ContextMenuEntry => ({ type: "item", id, label: id, ...extra });
const separator: ContextMenuEntry = { type: "separator" };

// Copy, a disabled Paste, a separator and a "Copy to layer" submenu whose
// last entry is disabled.
const ENTRIES: ContextMenuEntry[] = [
  item("copy"),
  item("paste", { disabled: true }),
  separator,
  item("copy-to-layer", {
    submenu: [
      item("auto"),
      separator,
      item("layer-1"),
      item("layer-2"),
      item("new", { disabled: true }),
    ],
  }),
];

describe("isContextMenuKey", () => {
  it("accepts the context-menu key and Shift+F10 only", () => {
    assert.equal(
      isContextMenuKey({ key: "ContextMenu", shiftKey: false }),
      true,
    );
    assert.equal(isContextMenuKey({ key: "F10", shiftKey: true }), true);
    assert.equal(isContextMenuKey({ key: "F10", shiftKey: false }), false);
    assert.equal(
      isContextMenuKey({ key: "F10", shiftKey: true, ctrlKey: true }),
      false,
    );
    assert.equal(isContextMenuKey({ key: "Enter", shiftKey: true }), false);
  });
});

describe("stepEnabledIndex", () => {
  it("skips separators and disabled items and wraps around", () => {
    assert.equal(stepEnabledIndex(ENTRIES, -1, 1), 0);
    assert.equal(stepEnabledIndex(ENTRIES, 0, 1), 3);
    assert.equal(stepEnabledIndex(ENTRIES, 3, 1), 0);
    assert.equal(stepEnabledIndex(ENTRIES, 0, -1), 3);
    assert.equal(stepEnabledIndex(ENTRIES, -1, -1), 3);
  });

  it("returns -1 when nothing is enabled", () => {
    assert.equal(stepEnabledIndex([item("a", { disabled: true })], -1, 1), -1);
    assert.equal(stepEnabledIndex([], -1, 1), -1);
  });
});

describe("handleMenuKey", () => {
  it("moves between enabled items with the arrow keys, Home and End", () => {
    assert.deepEqual(handleMenuKey(ENTRIES, [-1], "ArrowDown"), {
      type: "path",
      path: [0],
    });
    assert.deepEqual(handleMenuKey(ENTRIES, [0], "ArrowDown"), {
      type: "path",
      path: [3],
    });
    assert.deepEqual(handleMenuKey(ENTRIES, [0], "ArrowUp"), {
      type: "path",
      path: [3],
    });
    assert.deepEqual(handleMenuKey(ENTRIES, [3], "Home"), {
      type: "path",
      path: [0],
    });
    assert.deepEqual(handleMenuKey(ENTRIES, [0], "End"), {
      type: "path",
      path: [3],
    });
  });

  it("opens a submenu with → or Enter and closes it with ← or Escape", () => {
    assert.deepEqual(handleMenuKey(ENTRIES, [3], "ArrowRight"), {
      type: "path",
      path: [3, 0],
    });
    assert.deepEqual(handleMenuKey(ENTRIES, [3], "Enter"), {
      type: "path",
      path: [3, 0],
    });
    assert.deepEqual(handleMenuKey(ENTRIES, [3, 2], "ArrowLeft"), {
      type: "path",
      path: [3],
    });
    assert.deepEqual(handleMenuKey(ENTRIES, [3, 2], "Escape"), {
      type: "path",
      path: [3],
    });
  });

  it("moves inside an open submenu, skipping its disabled item", () => {
    assert.deepEqual(handleMenuKey(ENTRIES, [3, 0], "ArrowDown"), {
      type: "path",
      path: [3, 2],
    });
    assert.deepEqual(handleMenuKey(ENTRIES, [3, 3], "ArrowDown"), {
      type: "path",
      path: [3, 0],
    });
  });

  it("activates the highlighted item with Enter or Space", () => {
    const copy = handleMenuKey(ENTRIES, [0], "Enter");
    assert.equal(copy.type, "activate");
    assert.equal(copy.type === "activate" && copy.item.id, "copy");

    const layer = handleMenuKey(ENTRIES, [3, 3], " ");
    assert.equal(layer.type === "activate" && layer.item.id, "layer-2");
  });

  it("never activates a disabled item or an item without a submenu on →", () => {
    assert.deepEqual(handleMenuKey(ENTRIES, [1], "Enter"), { type: "ignore" });
    assert.deepEqual(handleMenuKey(ENTRIES, [3, 4], "Enter"), {
      type: "ignore",
    });
    assert.deepEqual(handleMenuKey(ENTRIES, [0], "ArrowRight"), {
      type: "ignore",
    });
    assert.deepEqual(handleMenuKey(ENTRIES, [0], "ArrowLeft"), {
      type: "ignore",
    });
  });

  it("closes the menu with Escape at the top level, or Tab", () => {
    assert.deepEqual(handleMenuKey(ENTRIES, [0], "Escape"), { type: "close" });
    assert.deepEqual(handleMenuKey(ENTRIES, [3, 0], "Tab"), { type: "close" });
  });
});

describe("hoverMenuPath", () => {
  it("highlights the hovered item and opens its submenu", () => {
    assert.deepEqual(hoverMenuPath(ENTRIES, [-1], 0, 0), [0]);
    assert.deepEqual(hoverMenuPath(ENTRIES, [0], 0, 3), [3, -1]);
    assert.deepEqual(hoverMenuPath(ENTRIES, [3, -1], 1, 2), [3, 2]);
  });

  it("closes an open submenu when another root item is hovered", () => {
    assert.deepEqual(hoverMenuPath(ENTRIES, [3, 2], 0, 0), [0]);
  });

  it("does not highlight a disabled item or a separator", () => {
    assert.deepEqual(hoverMenuPath(ENTRIES, [0], 0, 1), [-1]);
    assert.deepEqual(hoverMenuPath(ENTRIES, [3, 2], 1, 1), [3, -1]);
  });
});

describe("getLevelEntries", () => {
  it("returns the submenu opened by the path", () => {
    assert.equal(getLevelEntries(ENTRIES, [3, 0], 0), ENTRIES);
    const submenu = getLevelEntries(ENTRIES, [3, 0], 1);
    assert.equal(submenu?.length, 5);
    assert.equal(firstEnabledIndex(submenu ?? []), 0);
    assert.equal(getLevelEntries(ENTRIES, [0, 0], 1), undefined);
  });
});

describe("placeContextMenu", () => {
  const viewport = { width: 800, height: 600 };
  const size = { width: 200, height: 180 };

  it("opens below and to the right of the pointer when it fits", () => {
    assert.deepEqual(placeContextMenu({ x: 100, y: 120 }, size, viewport), {
      x: 100,
      y: 120,
    });
  });

  it("flips left near the right edge and up near the bottom", () => {
    assert.deepEqual(placeContextMenu({ x: 700, y: 500 }, size, viewport), {
      x: 500,
      y: 320,
    });
  });

  it("stays inside the viewport when it fits neither way", () => {
    const point = placeContextMenu(
      { x: 120, y: 100 },
      { width: 200, height: 580 },
      viewport,
    );
    assert.equal(point.x, 120);
    assert.equal(point.y, MENU_VIEWPORT_MARGIN);
  });
});

describe("placeSubmenu", () => {
  const viewport = { width: 800, height: 600 };
  const size = { width: 160, height: 150 };

  it("opens beside the item, level with it", () => {
    const itemRect = { left: 100, right: 300, top: 200, bottom: 228 };
    assert.deepEqual(placeSubmenu(itemRect, size, viewport, 4), {
      x: 300,
      y: 196,
    });
  });

  it("flips to the left near the right edge and up near the bottom", () => {
    const itemRect = { left: 560, right: 760, top: 520, bottom: 548 };
    assert.deepEqual(placeSubmenu(itemRect, size, viewport, 4), {
      x: 400,
      y: 402,
    });
  });
});
