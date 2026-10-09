import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContextMenuEntry, ContextMenuItem } from "../../context-menu.ts";
import type { FxDevice, FxDeviceGroup } from "../../fx-stack.ts";
import {
  type DeviceMenuState,
  type DeviceMoveTarget,
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

const TARGETS: DeviceMoveTarget[] = [
  { group: "global", label: "Global", allowed: true },
  { group: "layer", label: "Layer", allowed: false },
  { group: "clip", label: "Clip", allowed: true },
];

function open(
  target: FxDevice,
  {
    index = 1,
    stackSize = 3,
    fixed = false,
    moveTargets = TARGETS,
  }: Partial<{
    index: number;
    stackSize: number;
    fixed: boolean;
    moveTargets: DeviceMoveTarget[];
  }> = {},
) {
  const calls: string[] = [];
  const menu: DeviceMenuState = {
    type: "device",
    device: target,
    index,
    stackSize,
    x: 0,
    y: 0,
  };
  const entries = getDeviceMenuEntries(menu, {
    collapsed: new Set(),
    fixed,
    moveTargets,
    toggleCollapsed: () => calls.push("collapse"),
    onSetEnabled: () => calls.push("enable"),
    moveDevice: (_device, from, to) => calls.push(`move ${from}->${to}`),
    moveDeviceTo: (_device, group: FxDeviceGroup) =>
      calls.push(`move to ${group}`),
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
      "move 1->0",
      "move 1->2",
      "move to global",
      "move to layer",
      "move to clip",
    ]);
  });

  it("disables Left and Right at the ends of the stack", () => {
    assert.deepEqual(summarize(open(device(), { index: 0 }).move).slice(0, 2), [
      "(Left)",
      "Right",
    ]);
    assert.deepEqual(summarize(open(device(), { index: 2 }).move).slice(0, 2), [
      "Left",
      "(Right)",
    ]);
  });

  it("keeps a fixed device in its stack", () => {
    const { entries, move } = open(device({ effectName: "Text" }), {
      fixed: true,
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
    assert.deepEqual(summarize(move), [
      "Left",
      "Right",
      "(to Global)",
      "(to Layer)",
      "(to Clip)",
    ]);
  });

  it("offers a layer's own Layout Reset to Default but no Duplicate", () => {
    const { entries } = open(
      device({ effectName: "Layout", layerDefault: true }),
      {
        fixed: true,
      },
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
