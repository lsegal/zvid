import type { FxDevice, FxDeviceGroup } from "../../fx-stack";
import type { ContextMenuEntry } from "../ContextMenu";

// The device a context menu was opened on, and where.
export type DeviceMenuState = {
  device: FxDevice;
  index: number;
  x: number;
  y: number;
};

// Another stack a device can be sent to, and where it would land there.
export type DeviceStackTarget = {
  group: FxDeviceGroup;
  label: string;
  index: number;
};

type DeviceMenuActions = {
  collapsed: ReadonlySet<string>;
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
  // The other stacks the device can be sent to, left to right.
  stackTargets: readonly DeviceStackTarget[];
  resetDevice: (device: FxDevice) => void;
  duplicateDevice: (device: FxDevice) => void;
  removeDevice: (device: FxDevice) => void;
};

// The entries of a device's context menu.
export function getDeviceMenuEntries(
  menu: DeviceMenuState,
  {
    collapsed,
    toggleCollapsed,
    onSetEnabled,
    moveDevice,
    canMoveDevice,
    stackTargets,
    resetDevice,
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
      id: "move-left",
      label: "Move Left",
      shortcut: "Alt+←",
      disabled: !canMoveDevice(device, device.group, menu.index - 1),
      onSelect: () => moveDevice(device, device.group, menu.index - 1),
    },
    {
      type: "item",
      id: "move-right",
      label: "Move Right",
      shortcut: "Alt+→",
      disabled: !canMoveDevice(device, device.group, menu.index + 1),
      onSelect: () => moveDevice(device, device.group, menu.index + 1),
    },
    ...stackTargets.map(
      (target) =>
        ({
          type: "item",
          id: `move-to-${target.group}`,
          label: `Move to ${target.label}`,
          disabled: !canMoveDevice(device, target.group, target.index),
          onSelect: () => moveDevice(device, target.group, target.index),
        }) satisfies ContextMenuEntry,
    ),
    { type: "separator" },
    ...(device.layerDefault
      ? [
          {
            type: "item",
            id: "reset",
            label: "Reset to Default",
            onSelect: () => resetDevice(device),
          } satisfies ContextMenuEntry,
        ]
      : [
          {
            type: "item",
            id: "duplicate",
            label: "Duplicate",
            onSelect: () => duplicateDevice(device),
          } satisfies ContextMenuEntry,
          {
            type: "item",
            id: "delete",
            label: "Delete",
            shortcut: "Del",
            onSelect: () => removeDevice(device),
          } satisfies ContextMenuEntry,
        ]),
  ];
}
