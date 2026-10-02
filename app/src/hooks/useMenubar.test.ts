import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { menubarNeighbor } from "./useMenubar.ts";

const MENUS = ["file", "edit", "help"] as const;

describe("menubarNeighbor", () => {
  it("moves right and left between adjacent menus", () => {
    assert.equal(menubarNeighbor(MENUS, "file", "ArrowRight"), "edit");
    assert.equal(menubarNeighbor(MENUS, "edit", "ArrowRight"), "help");
    assert.equal(menubarNeighbor(MENUS, "help", "ArrowLeft"), "edit");
  });

  it("wraps around at both ends", () => {
    assert.equal(menubarNeighbor(MENUS, "help", "ArrowRight"), "file");
    assert.equal(menubarNeighbor(MENUS, "file", "ArrowLeft"), "help");
  });

  it("ignores other keys", () => {
    assert.equal(menubarNeighbor(MENUS, "file", "ArrowDown"), undefined);
    assert.equal(menubarNeighbor(MENUS, "file", "Enter"), undefined);
  });
});
