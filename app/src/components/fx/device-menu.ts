import type { FxDevice, FxDeviceGroup } from "../../fx-stack";
import type { ContextMenuEntry } from "../ContextMenu";

// The device a context menu was opened on, and where.
export type DeviceMenuState = {
  type: "device";
  device: FxDevice;
  index: number;
  stackSize: number;
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

// A stack a device's Move submenu offers, such as "to Global". A target
// that can't take the device is shown disabled.
export type DeviceMoveTarget = {
  group: FxDeviceGroup;
  label: string;
  allowed: boolean;
};

type DeviceMenuActions = {
  collapsed: ReadonlySet<string>;
  // True for a device that stays where it is: a layer's own Layout and the
  // content effect of the selected clip. It can't be cut, deleted or moved
  // to another stack.
  fixed: boolean;
  moveTargets: readonly DeviceMoveTarget[];
  toggleCollapsed: (deviceId: string) => void;
  onSetEnabled: (device: FxDevice, enabled: boolean) => void;
  moveDevice: (
    device: FxDevice,
    fromIndex: number,
    toIndex: number,
    stackSize: number,
  ) => void;
  moveDeviceTo: (device: FxDevice, group: FxDeviceGroup) => void;
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
    moveTargets,
    toggleCollapsed,
    onSetEnabled,
    moveDevice,
    moveDeviceTo,
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
          disabled: menu.index === 0,
          onSelect: () =>
            moveDevice(device, menu.index, menu.index - 1, menu.stackSize),
        },
        {
          type: "item",
          id: "move-right",
          label: "Right",
          shortcut: "Alt+→",
          disabled: menu.index >= menu.stackSize - 1,
          onSelect: () =>
            moveDevice(device, menu.index, menu.index + 1, menu.stackSize),
        },
        { type: "separator" },
        ...moveTargets.map(
          (target): ContextMenuEntry => ({
            type: "item",
            id: `move-to-${target.group}`,
            label: `to ${target.label}`,
            disabled: fixed || !target.allowed,
            onSelect: () => moveDeviceTo(device, target.group),
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
