import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContextMenuEntry, ContextMenuItem } from "../../context-menu.ts";
import type { FxDevice, FxDeviceGroup } from "../../fx-stack.ts";
import {
  type DeviceMenuState,
  type DeviceStackTarget,
  getDeviceMenuEntries,
  getSurfaceMenuEntries,
} from "./device-menu.ts";

function device(overrides: Partial<FxDevice> = {}) {
  return {
    id: "pixelate",
    effectName: "Pixelate",
    name: "Pixelate",
    group: "layer",
    enabled: true,
    ...overrides,
  } as FxDevice;
}

function items(entries: readonly ContextMenuEntry[]) {
  return entries.filter(
    (entry): entry is ContextMenuItem => entry.type === "item",
  );
}

function summarize(entries: readonly ContextMenuEntry[]) {
  return items(entries).map((item) =>
    item.disabled ? `(${item.label})` : item.label,
  );
}

const TARGETS: DeviceStackTarget[] = [
  { group: "global", label: "Global", index: 1 },
  { group: "layer", label: "Layer", index: 3 },
  { group: "clip", label: "Clip", index: 2 },
];

function open(
  target: FxDevice,
  {
    index = 1,
    fixed = false,
    // Where the device may go: "<group> <index>" keys.
    allowed = ["layer 0", "layer 2", "global 1", "clip 2"],
  }: Partial<{ index: number; fixed: boolean; allowed: string[] }> = {},
) {
  const calls: string[] = [];
  const menu: DeviceMenuState = {
    type: "device",
    device: target,
    index,
    x: 0,
    y: 0,
  };
  const entries = getDeviceMenuEntries(menu, {
    collapsed: new Set(),
    fixed,
    toggleCollapsed: () => calls.push("collapse"),
    onSetEnabled: () => calls.push("enable"),
    moveDevice: (_device, group: FxDeviceGroup, to) =>
      calls.push(`move ${group} ${to}`),
    canMoveDevice: (_device, group, to) => allowed.includes(`${group} ${to}`),
    stackTargets: TARGETS,
    resetDevice: () => calls.push("reset"),
    cutDevice: () => calls.push("cut"),
    copyDevice: () => calls.push("copy"),
    duplicateDevice: () => calls.push("duplicate"),
    removeDevice: () => calls.push("delete"),
  });
  const move = items(entries).find((item) => item.id === "move");
  return { entries, move: move?.submenu ?? [], calls };
}

describe("getDeviceMenuEntries", () => {
  it("offers Cut, Copy, Duplicate, Delete and a Move submenu", () => {
    const { entries, move } = open(device());
    assert.deepEqual(summarize(entries), [
      "Collapse",
      "Bypass",
      "Cut",
      "Copy",
      "Duplicate",
      "Delete",
      "Move",
    ]);
    // The device's own stack is never a target.
    assert.deepEqual(summarize(move), [
      "Left",
      "Right",
      "to Global",
      "(to Layer)",
      "to Clip",
    ]);
  });

  it("runs each action on the device", () => {
    const { entries, move, calls } = open(device());
    for (const item of [...items(entries), ...items(move)]) {
      item.onSelect?.();
    }
    assert.deepEqual(calls, [
      "collapse",
      "enable",
      "cut",
      "copy",
      "duplicate",
      "delete",
      "move layer 0",
      "move layer 2",
      "move global 1",
      "move layer 3",
      "move clip 2",
    ]);
  });

  it("disables the moves the chain refuses", () => {
    const { move } = open(device(), { allowed: ["layer 2", "clip 2"] });
    assert.deepEqual(summarize(move), [
      "(Left)",
      "Right",
      "(to Global)",
      "(to Layer)",
      "to Clip",
    ]);
  });

  it("disables Cut and Delete for a fixed device", () => {
    const { entries } = open(device({ effectName: "Text", group: "clip" }), {
      fixed: true,
      allowed: [],
    });
    assert.deepEqual(summarize(entries), [
      "Collapse",
      "Bypass",
      "(Cut)",
      "Copy",
      "Duplicate",
      "(Delete)",
      "Move",
    ]);
  });

  it("offers a layer's own Layout Reset to Default but no Duplicate", () => {
    const { entries } = open(
      device({ effectName: "Layout", layerDefault: true }),
      { fixed: true },
    );
    assert.deepEqual(summarize(entries), [
      "Collapse",
      "Bypass",
      "(Cut)",
      "Copy",
      "(Duplicate)",
      "(Delete)",
      "Move",
      "Reset to Default",
    ]);
  });
});

describe("getSurfaceMenuEntries", () => {
  function surface(canPaste: boolean, clearableCount: number) {
    const calls: string[] = [];
    const entries = getSurfaceMenuEntries(
      { type: "surface", group: "clip", x: 0, y: 0 },
      {
        canPaste,
        clearableCount,
        paste: (group) => calls.push(`paste ${group}`),
        clearAll: () => calls.push("clear"),
      },
    );
    return { entries, calls };
  }

  it("pastes onto the right-clicked stack and clears", () => {
    const { entries, calls } = surface(true, 2);
    assert.deepEqual(summarize(entries), ["Paste", "Clear All"]);
    for (const item of items(entries)) {
      item.onSelect?.();
    }
    assert.deepEqual(calls, ["paste clip", "clear"]);
  });

  it("disables Paste and Clear All when they would do nothing", () => {
    assert.deepEqual(summarize(surface(false, 0).entries), [
      "(Paste)",
      "(Clear All)",
    ]);
  });
});
