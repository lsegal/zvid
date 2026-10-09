import type { ContextMenuEntry } from "../../context-menu";
import type { FxDevice, FxDeviceGroup } from "../../fx-stack";

// The device a context menu was opened on, and where.
export type DeviceMenuState = {
  type: "device";
  device: FxDevice;
  index: number;
  x: number;
  y: number;
};

// The stack whose empty space a context menu was opened on, and where.
export type SurfaceMenuState = {
  type: "surface";
  group: FxDeviceGroup;
  x: number;
  y: number;
};

export type FxChainMenuState = DeviceMenuState | SurfaceMenuState;

// Another stack a device can be sent to, and where it would land there.
export type DeviceStackTarget = {
  group: FxDeviceGroup;
  label: string;
  index: number;
};

type DeviceMenuActions = {
  collapsed: ReadonlySet<string>;
  // True for a device that can't be cut or deleted: a layer's own Layout
  // and the clip's content device.
  fixed: boolean;
  toggleCollapsed: (deviceId: string) => void;
  onSetEnabled: (device: FxDevice, enabled: boolean) => void;
  moveDevice: (
    device: FxDevice,
    toGroup: FxDeviceGroup,
    toIndex: number,
  ) => void;
  canMoveDevice: (
    device: FxDevice,
    toGroup: FxDeviceGroup,
    toIndex: number,
  ) => boolean;
  // Every stack, left to right, for the Move submenu. The device's own
  // stack and those that can't take it are shown disabled.
  stackTargets: readonly DeviceStackTarget[];
  resetDevice: (device: FxDevice) => void;
  cutDevice: (device: FxDevice) => void;
  copyDevice: (device: FxDevice) => void;
  duplicateDevice: (device: FxDevice) => void;
  removeDevice: (device: FxDevice) => void;
};

// The entries of a device's context menu.
export function getDeviceMenuEntries(
  menu: DeviceMenuState,
  {
    collapsed,
    fixed,
    toggleCollapsed,
    onSetEnabled,
    moveDevice,
    canMoveDevice,
    stackTargets,
    resetDevice,
    cutDevice,
    copyDevice,
    duplicateDevice,
    removeDevice,
  }: DeviceMenuActions,
): ContextMenuEntry[] {
  const { device } = menu;
  return [
    {
      type: "item",
      id: "collapse",
      label: collapsed.has(device.id) ? "Expand" : "Collapse",
      onSelect: () => toggleCollapsed(device.id),
    },
    {
      type: "item",
      id: "enable",
      label: device.enabled ? "Bypass" : "Enable",
      onSelect: () => onSetEnabled(device, !device.enabled),
    },
    { type: "separator" },
    {
      type: "item",
      id: "cut",
      label: "Cut",
      disabled: fixed,
      onSelect: () => cutDevice(device),
    },
    {
      type: "item",
      id: "copy",
      label: "Copy",
      onSelect: () => copyDevice(device),
    },
    {
      type: "item",
      id: "duplicate",
      label: "Duplicate",
      // Every layer has exactly one Layout.
      disabled: device.layerDefault,
      onSelect: () => duplicateDevice(device),
    },
    {
      type: "item",
      id: "delete",
      label: "Delete",
      shortcut: "Del",
      disabled: fixed,
      onSelect: () => removeDevice(device),
    },
    { type: "separator" },
    {
      type: "item",
      id: "move",
      label: "Move",
      submenu: [
        {
          type: "item",
          id: "move-left",
          label: "Left",
          shortcut: "Alt+←",
          disabled: !canMoveDevice(device, device.group, menu.index - 1),
          onSelect: () => moveDevice(device, device.group, menu.index - 1),
        },
        {
          type: "item",
          id: "move-right",
          label: "Right",
          shortcut: "Alt+→",
          disabled: !canMoveDevice(device, device.group, menu.index + 1),
          onSelect: () => moveDevice(device, device.group, menu.index + 1),
        },
        { type: "separator" },
        ...stackTargets.map(
          (target): ContextMenuEntry => ({
            type: "item",
            id: `move-to-${target.group}`,
            label: `to ${target.label}`,
            disabled:
              target.group === device.group ||
              !canMoveDevice(device, target.group, target.index),
            onSelect: () => moveDevice(device, target.group, target.index),
          }),
        ),
      ],
    },
    ...(device.layerDefault
      ? [
          { type: "separator" } satisfies ContextMenuEntry,
          {
            type: "item",
            id: "reset",
            label: "Reset to Default",
            onSelect: () => resetDevice(device),
          } satisfies ContextMenuEntry,
        ]
      : []),
  ];
}

type SurfaceMenuActions = {
  // Whether Paste can put the cut or copied device on this stack.
  canPaste: boolean;
  // How many devices Clear All would remove.
  clearableCount: number;
  paste: (group: FxDeviceGroup) => void;
  clearAll: () => void;
};

// The entries of the context menu on a stack's empty space.
export function getSurfaceMenuEntries(
  menu: SurfaceMenuState,
  { canPaste, clearableCount, paste, clearAll }: SurfaceMenuActions,
): ContextMenuEntry[] {
  return [
    {
      type: "item",
      id: "paste",
      label: "Paste",
      disabled: !canPaste,
      onSelect: () => paste(menu.group),
    },
    { type: "separator" },
    {
      type: "item",
      id: "clear-all",
      label: "Clear All",
      disabled: clearableCount === 0,
      onSelect: clearAll,
    },
  ];
}
