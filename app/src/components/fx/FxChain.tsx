import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import type { EffectAnimation } from "../../fx-animation-defaults";
import {
  addableEffectsFor,
  animationCollapseKey,
  canStartFxChainPan,
  describeDeviceMove,
  type FxLayerOption,
  groupChainDevices,
  readCollapsedDevices,
  toggleCollapsedDevice,
  writeCollapsedDevices,
} from "../../fx-chain";
import type { FxEffectScope } from "../../fx-registry";
import {
  type FxDevice,
  type FxDeviceGroup,
  GLOBAL_EFFECT_TRACK_ID,
} from "../../fx-stack";
import { useDragScroll } from "../../use-drag-scroll";
import { ContextMenu } from "../ContextMenu";
import { usePrefersReducedMotion } from "../MediaSyncSkeleton";
import { AddDeviceMenu } from "./AddDeviceMenu";
import { type DeviceMenuState, getDeviceMenuEntries } from "./device-menu";
import { FxAnimationPanel } from "./FxAnimationPanel";
import { FxDevicePanel } from "./FxDevicePanel";
import type { FxEditMode, FxSetParameter } from "./types";
import { useDeviceDrag } from "./use-device-drag";
import { useWheelScrollX } from "./use-wheel-scroll-x";
import "./fx-chain.css";

export type FxChainProps = {
  devices: FxDevice[];
  kind: string | undefined;
  // Track id of the selected layer's stack; undefined when none is.
  layerTrackId: string | undefined;
  // Name of the selected layer, such as "Layer 3"; undefined when none is.
  layerName: string | undefined;
  // Track id of the selected clip's own stack; undefined when no clip is
  // selected, which hides the Clip section.
  clipTrackId?: string;
  // The scope the Clip section's add menu offers: "fxClip" for an FX clip.
  clipScope?: FxEffectScope;
  // False when the selected layer's FX badge bypasses its whole stack.
  layerFxEnabled?: boolean;
  // The layers the Global Order's Layers menu lists, in timeline order.
  layers?: readonly FxLayerOption[];
  // The layers beneath the selected FX clip, which its Order's menu lists.
  clipLayers?: readonly FxLayerOption[];
  onSetLayerFxEnabled?: (enabled: boolean) => void;
  onSetEnabled: (device: FxDevice, enabled: boolean) => void;
  // Turns a device's Animation modifier on or off.
  onSetAnimationEnabled?: (device: FxDevice, enabled: boolean) => void;
  // Changes a device's animation settings. Knob drags send `transient`
  // updates and a `commit` at the end.
  onSetAnimation?: (
    device: FxDevice,
    animation: EffectAnimation,
    mode: FxEditMode,
  ) => void;
  onSetParameter: FxSetParameter;
  onMove: (device: FxDevice, toIndex: number) => void;
  onAdd: (trackId: string, effectName: string, id: string) => void;
  onRemove: (device: FxDevice) => void;
  onDuplicate: (device: FxDevice, id: string) => void;
  onReset: (device: FxDevice) => void;
};

function getStorage() {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

// Presses inside the chain's own DOM that start a pan. React also bubbles
// events from its portalled menus through the chain, which must not pan it.
function canStartChainPan(event: ReactMouseEvent<HTMLElement>) {
  return (
    event.currentTarget.contains(event.target as Node) &&
    canStartFxChainPan(event)
  );
}

function getTrackId(
  group: FxDeviceGroup,
  layerTrackId: string | undefined,
  clipTrackId: string | undefined,
) {
  if (group === "global") {
    return GLOBAL_EFFECT_TRACK_ID;
  }
  return group === "clip" ? clipTrackId : layerTrackId;
}

const SECTION_LABELS: Record<FxDeviceGroup, string> = {
  global: "Global",
  layer: "Layer",
  clip: "Clip",
};

const NO_LAYERS: readonly FxLayerOption[] = [];

const ADD_MENU_LABELS: Record<FxDeviceGroup, string> = {
  global: "Add device to Global",
  layer: "Add device to this layer",
  clip: "Add device to this clip",
};

export function FxChain({
  devices,
  kind,
  layerTrackId,
  layerName,
  clipTrackId,
  clipScope = "clip",
  layerFxEnabled = true,
  layers = NO_LAYERS,
  clipLayers = NO_LAYERS,
  onSetLayerFxEnabled,
  onSetEnabled,
  onSetAnimationEnabled,
  onSetAnimation,
  onSetParameter,
  onMove,
  onAdd,
  onRemove,
  onDuplicate,
  onReset,
}: FxChainProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Title bar (or add button) to focus once the next render lands, so
  // keyboard focus follows a moved, added or removed device. Menus close
  // after that render and would return focus to their trigger, so they read
  // the same target from menuFocusRef when they finish closing.
  const pendingFocusRef = useRef<string | null>(null);
  const menuFocusRef = useRef<string | null>(null);
  const menuDeviceIdRef = useRef<string | null>(null);
  const [collapsed, setCollapsed] = useState(() =>
    readCollapsedDevices(getStorage()),
  );
  const [menu, setMenu] = useState<DeviceMenuState | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const groups = groupChainDevices(devices, kind);
  const { drag, beginDrag, suppressClickRef } = useDeviceDrag({
    scrollRef,
    groups,
    moveDevice,
    setAnnouncement,
  });
  const canEdit = kind !== "audio" && layerTrackId !== undefined;
  const showClip = canEdit && clipTrackId !== undefined;
  // Dragging the chain's background, or middle-dragging anywhere in it,
  // pans it sideways.
  const prefersReducedMotion = usePrefersReducedMotion();
  const chainDragScroll = useDragScroll({
    scrollRef,
    canStart: canStartChainPan,
    axis: "x",
    momentum: !prefersReducedMotion,
  });

  useWheelScrollX(scrollRef);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after every device change to restore focus
  useEffect(() => {
    const target = pendingFocusRef.current;
    if (!target) {
      return;
    }

    pendingFocusRef.current = null;
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-fx-focus="${CSS.escape(target)}"]`)
      ?.focus();
  }, [devices]);

  function focusTitle(deviceId: string) {
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-fx-focus="${CSS.escape(deviceId)}"]`)
      ?.focus();
  }

  function requestFocus(target: string) {
    pendingFocusRef.current = target;
    menuFocusRef.current = target;
  }

  // Moves focus to the requested device once a menu has closed. Returns
  // false when no action asked for focus.
  function focusAfterMenu() {
    const target = menuFocusRef.current;
    menuFocusRef.current = null;
    pendingFocusRef.current = null;
    if (!target) {
      return false;
    }

    focusTitle(target);
    return true;
  }

  function toggleCollapsed(deviceId: string) {
    setCollapsed((current) => {
      const next = toggleCollapsedDevice(current, deviceId);
      writeCollapsedDevices(getStorage(), next);
      return next;
    });
  }

  function moveDevice(
    device: FxDevice,
    fromIndex: number,
    toIndex: number,
    stackSize: number,
  ) {
    if (toIndex < 0 || toIndex >= stackSize || toIndex === fromIndex) {
      return;
    }

    requestFocus(device.id);
    onMove(device, toIndex);
    setAnnouncement(describeDeviceMove(device, toIndex, stackSize));
  }

  function removeDevice(device: FxDevice) {
    // A layer's own Layout can only be reset, not removed.
    if (device.layerDefault) {
      return;
    }

    const stack = groups[device.group];
    const index = stack.findIndex((candidate) => candidate.id === device.id);
    const neighbor = stack[index + 1] ?? stack[index - 1];
    requestFocus(neighbor?.id ?? `add-${device.group}`);
    onRemove(device);
    setAnnouncement(`Removed ${device.name}`);
  }

  function resetDevice(device: FxDevice) {
    onReset(device);
    setAnnouncement(`Reset ${device.name}`);
  }

  function duplicateDevice(device: FxDevice) {
    const id = crypto.randomUUID();
    requestFocus(id);
    onDuplicate(device, id);
    setAnnouncement(`Duplicated ${device.name}`);
  }

  // The scope a section's add menu offers effects for.
  function scopeOf(group: FxDeviceGroup): FxEffectScope {
    return group === "clip" ? clipScope : group;
  }

  function addDevice(group: FxDeviceGroup, effectName: string) {
    const trackId = getTrackId(group, layerTrackId, clipTrackId);
    const definition = addableEffectsFor(scopeOf(group)).find(
      (candidate) => candidate.effectName === effectName,
    );
    if (!trackId || !definition) {
      return;
    }

    const id = crypto.randomUUID();
    requestFocus(id);
    onAdd(trackId, effectName, id);
    setAnnouncement(`Added ${definition.displayName}`);
  }

  function handleTitleKeyDown(
    event: ReactKeyboardEvent<HTMLElement>,
    device: FxDevice,
    index: number,
    stackSize: number,
  ) {
    if (
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      event.preventDefault();
      event.stopPropagation();
      moveDevice(
        device,
        index,
        index + (event.key === "ArrowLeft" ? -1 : 1),
        stackSize,
      );
      return;
    }

    if (
      (event.key === "Delete" || event.key === "Backspace") &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      // The app deletes the selected clip on Delete; this one is ours.
      event.preventDefault();
      event.stopPropagation();
      removeDevice(device);
    }
  }

  function openContextMenu(
    event: ReactMouseEvent<HTMLElement>,
    device: FxDevice,
    index: number,
    stackSize: number,
  ) {
    event.preventDefault();
    // The context-menu key and Shift+F10 report no pointer position.
    let { clientX: x, clientY: y } = event;
    if (!x && !y) {
      const rect = event.currentTarget.getBoundingClientRect();
      x = rect.left;
      y = rect.bottom;
    }
    menuDeviceIdRef.current = device.id;
    menuFocusRef.current = null;
    setMenu({ device, index, stackSize, x, y });
  }

  function renderStack(group: FxDeviceGroup) {
    const stack = groups[group];
    return stack.map((device, index) => {
      const animation =
        device.supportsAnimation && device.animation?.enabled
          ? device.animation
          : undefined;
      const layerBypassed = device.group === "layer" && !layerFxEnabled;
      const dragging = drag?.deviceId === device.id;
      const panel = (
        <FxDevicePanel
          key={device.id}
          attached={animation !== undefined}
          collapsed={collapsed.has(device.id)}
          device={device}
          dragging={dragging}
          onContextMenu={(event) =>
            openContextMenu(event, device, index, stack.length)
          }
          onRemove={() => removeDevice(device)}
          layerBypassed={layerBypassed}
          onSetEnabled={onSetEnabled}
          onSetAnimationEnabled={onSetAnimationEnabled}
          layers={device.group === "clip" ? clipLayers : layers}
          onSetParameter={onSetParameter}
          onStripClick={() => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            toggleCollapsed(device.id);
          }}
          onTitleKeyDown={(event) =>
            handleTitleKeyDown(event, device, index, stack.length)
          }
          onTitlePointerDown={(event) => beginDrag(event, device, index)}
          onToggleCollapsed={() => toggleCollapsed(device.id)}
        />
      );
      if (!animation) {
        return panel;
      }

      // The Animation section is attached to the device's right edge, and
      // the pair is one panel of the stack.
      const animationKey = animationCollapseKey(device.id);
      return (
        <div
          className={`fx-device-unit${dragging ? " fx-device-unit--dragging" : ""}`}
          data-fx-group={device.group}
          key={device.id}
        >
          {panel}
          <FxAnimationPanel
            animation={animation}
            bypassed={!device.enabled || layerBypassed}
            collapsed={collapsed.has(animationKey)}
            device={device}
            onSetAnimation={onSetAnimation}
            onToggleCollapsed={() => toggleCollapsed(animationKey)}
          />
        </div>
      );
    });
  }

  function renderAddMenu(group: FxDeviceGroup, withLabel = false) {
    const label = ADD_MENU_LABELS[group];
    return (
      <AddDeviceMenu
        effects={addableEffectsFor(scopeOf(group))}
        focusKey={`add-${group}`}
        label={label}
        onAdd={(effectName) => addDevice(group, effectName)}
        onCloseAutoFocus={(event) => {
          if (focusAfterMenu()) {
            event.preventDefault();
          }
        }}
        onOpen={() => {
          menuFocusRef.current = null;
        }}
        withLabel={withLabel}
      />
    );
  }

  function renderDivider(group: FxDeviceGroup) {
    return (
      <div className="fx-chain__divider" data-fx-divider={group}>
        <span>{SECTION_LABELS[group]}</span>
      </div>
    );
  }

  const layerEmpty = !groups.layer.length;
  const emptyMessage = !layerName
    ? "Select a layer to see its effects"
    : layerEmpty
      ? `No effects on ${layerName}`
      : null;
  const showGlobal = groups.global.length > 0 || canEdit;
  const menuDevice = menu?.device;
  const menuEntries = menu
    ? getDeviceMenuEntries(menu, {
        collapsed,
        toggleCollapsed,
        onSetEnabled,
        moveDevice,
        resetDevice,
        duplicateDevice,
        removeDevice,
      })
    : [];

  return (
    <div
      className={`fx-chain ${drag ? "fx-chain--dragging" : ""} ${
        chainDragScroll.isGrabbing ? "fx-chain--grab-scrolling" : ""
      }`}
      ref={scrollRef}
      {...chainDragScroll.handlers}
    >
      {showGlobal ? (
        <>
          {renderDivider("global")}
          {renderStack("global")}
          {canEdit ? renderAddMenu("global") : null}
        </>
      ) : null}
      {layerName ? renderDivider("layer") : null}
      {emptyMessage ? (
        <div className="fx-chain__empty">
          <p>{emptyMessage}</p>
          {canEdit && layerEmpty ? renderAddMenu("layer", true) : null}
        </div>
      ) : null}
      {!layerEmpty && !layerFxEnabled ? (
        <div className="fx-chain__layer-off">
          <span>Layer FX off</span>
          <button onClick={() => onSetLayerFxEnabled?.(true)} type="button">
            On
          </button>
        </div>
      ) : null}
      {renderStack("layer")}
      {canEdit && !layerEmpty ? renderAddMenu("layer") : null}
      {showClip ? (
        <>
          {renderDivider("clip")}
          {renderStack("clip")}
          {renderAddMenu("clip")}
        </>
      ) : null}
      {drag?.markerX != null ? (
        <div
          aria-hidden="true"
          className="fx-chain__marker"
          style={{ left: drag.markerX }}
        />
      ) : null}
      <div aria-live="polite" className="fx-chain__status" role="status">
        {announcement}
      </div>
      <ContextMenu
        anchor={menu}
        entries={menuEntries}
        label={menuDevice ? `${menuDevice.name} actions` : "Device actions"}
        onClose={() => setMenu(null)}
        onCloseFocus={() => {
          if (!focusAfterMenu() && menuDeviceIdRef.current) {
            focusTitle(menuDeviceIdRef.current);
          }
          return true;
        }}
      />
    </div>
  );
}
