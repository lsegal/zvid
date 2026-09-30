import type { FxDevice } from "../../fx-stack";
import type { ContextMenuEntry } from "../ContextMenu";

// The device a context menu was opened on, and where.
export type DeviceMenuState = {
  device: FxDevice;
  index: number;
  stackSize: number;
  x: number;
  y: number;
};

type DeviceMenuActions = {
  collapsed: ReadonlySet<string>;
  toggleCollapsed: (deviceId: string) => void;
  onSetEnabled: (device: FxDevice, enabled: boolean) => void;
  moveDevice: (
    device: FxDevice,
    fromIndex: number,
    toIndex: number,
    stackSize: number,
  ) => void;
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
      disabled: menu.index === 0,
      onSelect: () =>
        moveDevice(device, menu.index, menu.index - 1, menu.stackSize),
    },
    {
      type: "item",
      id: "move-right",
      label: "Move Right",
      shortcut: "Alt+→",
      disabled: menu.index >= menu.stackSize - 1,
      onSelect: () =>
        moveDevice(device, menu.index, menu.index + 1, menu.stackSize),
    },
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
