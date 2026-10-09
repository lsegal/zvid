import type { MouseEvent as ReactMouseEvent } from "react";
import {
  canPlaceDevice,
  type FxChainGroups,
  getClearableDevices,
  isFixedDevice,
} from "../../fx-chain";
import { type FxEffectScope, getEffectDefinition } from "../../fx-registry";
import type { FxDevice, FxDeviceGroup } from "../../fx-stack";
import { getSurfaceMenuEntries, type SurfaceMenuState } from "./device-menu";
import { findStackAt } from "./use-device-drag";

type ChainClipboardOptions = {
  groups: FxChainGroups;
  // The stacks shown with a track, which devices can be pasted onto.
  editableSections: readonly FxDeviceGroup[];
  // The effect of the cut or copied device; undefined until one is.
  clipboardEffectName: string | undefined;
  scopeOf: (group: FxDeviceGroup) => FxEffectScope;
  trackIdOf: (group: FxDeviceGroup) => string | undefined;
  sectionName: (group: FxDeviceGroup) => string;
  requestFocus: (target: string) => void;
  setAnnouncement: (announcement: string) => void;
  onCut: (device: FxDevice) => void;
  onCopy: (device: FxDevice) => void;
  onPaste: (trackId: string, scope: FxEffectScope, id: string) => void;
  onClearAll: (devices: readonly FxDevice[]) => void;
};

// The FX chain's Cut, Copy and Paste, and the menu on a stack's empty space
// with Paste and Clear All. Each action is announced in the chain's live
// region.
export function getChainClipboard({
  groups,
  editableSections,
  clipboardEffectName,
  scopeOf,
  trackIdOf,
  sectionName,
  requestFocus,
  setAnnouncement,
  onCut,
  onCopy,
  onPaste,
  onClearAll,
}: ChainClipboardOptions) {
  function cutDevice(device: FxDevice) {
    if (isFixedDevice(device)) {
      return;
    }

    const stack = groups[device.group];
    const index = stack.findIndex((candidate) => candidate.id === device.id);
    const neighbor = stack[index + 1] ?? stack[index - 1];
    requestFocus(neighbor?.id ?? `add-${device.group}`);
    onCut(device);
    setAnnouncement(`Cut ${device.name}`);
  }

  function copyDevice(device: FxDevice) {
    onCopy(device);
    setAnnouncement(`Copied ${device.name}`);
  }

  function canPaste(group: FxDeviceGroup) {
    return (
      clipboardEffectName !== undefined &&
      editableSections.includes(group) &&
      canPlaceDevice(clipboardEffectName, scopeOf(group), groups[group])
    );
  }

  function paste(group: FxDeviceGroup) {
    const trackId = trackIdOf(group);
    if (!trackId || !clipboardEffectName || !canPaste(group)) {
      return;
    }

    const id = crypto.randomUUID();
    requestFocus(id);
    onPaste(trackId, scopeOf(group), id);
    const name = getEffectDefinition(clipboardEffectName).displayName;
    setAnnouncement(`Pasted ${name} to ${sectionName(group)}`);
  }

  function clearAll() {
    const cleared = getClearableDevices(groups);
    if (!cleared.length) {
      return;
    }

    onClearAll(cleared);
    const noun = cleared.length === 1 ? "device" : "devices";
    setAnnouncement(`Cleared ${cleared.length} ${noun}`);
  }

  // The menu a right-click on a section's empty space opens, or undefined
  // when the click lands elsewhere. Devices open their own menu, the
  // chain's leading devices sit left of every section, and the menus React
  // bubbles through the chain open none.
  function getSurfaceMenu(
    event: ReactMouseEvent<HTMLElement>,
  ): SurfaceMenuState | undefined {
    const chain = event.currentTarget;
    const target = event.target as Element;
    const section = target.closest("section");
    if (
      event.defaultPrevented ||
      !chain.contains(target) ||
      (section && chain.contains(section))
    ) {
      return undefined;
    }

    // The context-menu key and Shift+F10 report no pointer position.
    let { clientX: x, clientY: y } = event;
    if (!x && !y) {
      const rect = target.getBoundingClientRect();
      x = rect.left;
      y = rect.bottom;
    }
    const group = findStackAt(chain, x);
    return group && editableSections.includes(group)
      ? { type: "surface", group, x, y }
      : undefined;
  }

  function getSurfaceEntries(menu: SurfaceMenuState) {
    return getSurfaceMenuEntries(menu, {
      canPaste: canPaste(menu.group),
      clearableCount: getClearableDevices(groups).length,
      paste,
      clearAll,
    });
  }

  return { cutDevice, copyDevice, getSurfaceMenu, getSurfaceEntries };
}
