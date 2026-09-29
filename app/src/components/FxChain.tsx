import {
  CheckIcon,
  ChevronLeftIcon,
  PlusIcon,
  PowerIcon,
  XMarkIcon,
} from "@heroicons/react/24/solid";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import ColorPicker from "react-best-gradient-color-picker";
import { parseLayerIdList, toggleLayerId } from "../composition-order";
import {
  addableEffectsFor,
  canStartFxChainPan,
  describeArrangedLayers,
  describeDeviceMove,
  dropSlotToStackIndex,
  excludeAllLayers,
  FX_CHAIN_SECTIONS,
  type FxLayerOption,
  getAutoScrollDelta,
  getDropSlot,
  getParameterFormat,
  groupChainDevices,
  isNoopDropSlot,
  knobColumnCount,
  readCollapsedDevices,
  resolveGlobalOrderHint,
  splitDeviceParameters,
  toggleCollapsedDevice,
  usesColumnLayout,
  writeCollapsedDevices,
} from "../fx-chain";
import type { FxEffectDefinition, FxEffectScope } from "../fx-registry";
import {
  type FxDevice,
  type FxDeviceGroup,
  type FxDeviceParameter,
  GLOBAL_EFFECT_TRACK_ID,
} from "../fx-stack";
import { toggleStyleFlag } from "../text-style";
import { useDragScroll } from "../use-drag-scroll";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { FontPicker } from "./FontPicker";
import { usePrefersReducedMotion } from "./MediaSyncSkeleton";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemIndicator,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Knob } from "./ui/Knob";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import "./fx-chain.css";

export type FxEditMode = "commit" | "transient";

type FxChainProps = {
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
  // The layers an Order's Layers menu lists, in timeline order.
  layers?: readonly FxLayerOption[];
  onSetLayerFxEnabled?: (enabled: boolean) => void;
  onSetEnabled: (device: FxDevice, enabled: boolean) => void;
  onSetParameter: (
    device: FxDevice,
    key: string,
    value: number | string,
    mode: FxEditMode,
  ) => void;
  onMove: (device: FxDevice, toIndex: number) => void;
  onAdd: (trackId: string, effectName: string, id: string) => void;
  onRemove: (device: FxDevice) => void;
  onDuplicate: (device: FxDevice, id: string) => void;
  onReset: (device: FxDevice) => void;
};

// Pixels the pointer travels before a press on a title bar becomes a drag.
const DRAG_THRESHOLD = 4;

type DragSession = {
  device: FxDevice;
  fromIndex: number;
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  active: boolean;
  slot: number | null;
  frame: number;
};

type DragView = {
  deviceId: string;
  // Insertion marker position in scroll content coordinates, or null when
  // the pointer is over the other stack and the drop would be rejected.
  markerX: number | null;
};

type ContextMenuState = {
  device: FxDevice;
  index: number;
  stackSize: number;
  x: number;
  y: number;
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
  onSetLayerFxEnabled,
  onSetEnabled,
  onSetParameter,
  onMove,
  onAdd,
  onRemove,
  onDuplicate,
  onReset,
}: FxChainProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragSession | null>(null);
  const endDragRef = useRef<(() => void) | null>(null);
  const suppressClickRef = useRef(false);
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
  const [drag, setDrag] = useState<DragView | null>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const groups = groupChainDevices(devices, kind);
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

  // A vertical wheel scrolls the chain sideways. React registers wheel
  // listeners as passive, so preventDefault needs a native listener. Knobs
  // handle their own wheel events and cancel them first.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        Math.abs(event.deltaY) <= Math.abs(event.deltaX)
      ) {
        return;
      }

      const maxScroll = scroller.scrollWidth - scroller.clientWidth;
      if (maxScroll <= 0) {
        return;
      }

      const scale =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? scroller.clientWidth
            : 1;
      event.preventDefault();
      scroller.scrollLeft += event.deltaY * scale;
    };

    scroller.addEventListener("wheel", handleWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => () => endDragRef.current?.(), []);

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
    const neighbour = stack[index + 1] ?? stack[index - 1];
    requestFocus(neighbour?.id ?? `add-${device.group}`);
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

  // Panels of one stack, in stack order.
  function getStackPanels(group: FxDeviceGroup) {
    return Array.from(
      scrollRef.current?.querySelectorAll<HTMLElement>(
        `[data-fx-group="${group}"]`,
      ) ?? [],
    );
  }

  function updateDropTarget() {
    const session = dragRef.current;
    const scroller = scrollRef.current;
    if (!session?.active || !scroller) {
      return;
    }

    const { group } = session.device;
    const pointerX = session.lastX;
    // A stack spans from the middle of its own divider to the middle of the
    // next one; devices only move within their stack.
    const dividerX = (section: FxDeviceGroup | undefined) => {
      const divider = section
        ? scroller
            .querySelector<HTMLElement>(`[data-fx-divider="${section}"]`)
            ?.getBoundingClientRect()
        : undefined;
      return divider ? divider.left + divider.width / 2 : undefined;
    };
    const sectionIndex = FX_CHAIN_SECTIONS.indexOf(group);
    const startX = dividerX(group) ?? Number.NEGATIVE_INFINITY;
    const endX =
      dividerX(FX_CHAIN_SECTIONS[sectionIndex + 1]) ?? Number.POSITIVE_INFINITY;
    const overOtherStack = pointerX < startX || pointerX > endX;

    const panels = getStackPanels(group).map((panel) =>
      panel.getBoundingClientRect(),
    );
    if (overOtherStack || !panels.length) {
      session.slot = null;
      setDrag({ deviceId: session.device.id, markerX: null });
      return;
    }

    const slot = getDropSlot(
      panels.map((rect) => rect.left + rect.width / 2),
      pointerX,
    );
    session.slot = slot;
    if (isNoopDropSlot(session.fromIndex, slot)) {
      setDrag({ deviceId: session.device.id, markerX: null });
      return;
    }

    const scrollerRect = scroller.getBoundingClientRect();
    const gap = Number.parseFloat(getComputedStyle(scroller).columnGap) || 0;
    const edgeX =
      slot === 0 ? panels[0].left - gap / 2 : panels[slot - 1].right + gap / 2;
    setDrag({
      deviceId: session.device.id,
      markerX: edgeX - scrollerRect.left + scroller.scrollLeft,
    });
  }

  function autoScroll() {
    const session = dragRef.current;
    const scroller = scrollRef.current;
    if (!session?.active || !scroller) {
      return;
    }

    const rect = scroller.getBoundingClientRect();
    const delta = getAutoScrollDelta(session.lastX, rect.left, rect.right);
    if (delta) {
      const before = scroller.scrollLeft;
      scroller.scrollLeft += delta;
      if (scroller.scrollLeft !== before) {
        updateDropTarget();
      }
    }
    session.frame = requestAnimationFrame(autoScroll);
  }

  function beginDrag(
    event: ReactPointerEvent<HTMLElement>,
    device: FxDevice,
    index: number,
  ) {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      dragRef.current ||
      (event.target as HTMLElement).closest("[data-fx-no-drag]")
    ) {
      return;
    }

    suppressClickRef.current = false;
    dragRef.current = {
      device,
      fromIndex: index,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      active: false,
      slot: null,
      frame: 0,
    };

    const handleMove = (moveEvent: PointerEvent) => {
      const session = dragRef.current;
      if (!session || moveEvent.pointerId !== session.pointerId) {
        return;
      }

      session.lastX = moveEvent.clientX;
      if (!session.active) {
        if (
          Math.hypot(
            moveEvent.clientX - session.startX,
            moveEvent.clientY - session.startY,
          ) < DRAG_THRESHOLD
        ) {
          return;
        }

        session.active = true;
        suppressClickRef.current = true;
        document.body.classList.add("fx-chain-dragging");
        session.frame = requestAnimationFrame(autoScroll);
      }

      moveEvent.preventDefault();
      updateDropTarget();
    };

    const finish = (commit: boolean) => {
      const session = dragRef.current;
      endDrag();
      if (!commit || !session?.active || session.slot === null) {
        return;
      }

      const stackSize = groups[session.device.group].length;
      moveDevice(
        session.device,
        session.fromIndex,
        dropSlotToStackIndex(session.fromIndex, session.slot),
        stackSize,
      );
    };

    const handleUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId === dragRef.current?.pointerId) {
        finish(true);
      }
    };

    const handleCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId === dragRef.current?.pointerId) {
        finish(false);
      }
    };

    const handleKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape") {
        return;
      }

      // Keep Escape from also clearing selections elsewhere in the app.
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      if (dragRef.current?.active) {
        setAnnouncement(`Cancelled moving ${device.name}`);
      }
      finish(false);
    };

    function endDrag() {
      const session = dragRef.current;
      if (session) {
        cancelAnimationFrame(session.frame);
      }
      dragRef.current = null;
      endDragRef.current = null;
      document.body.classList.remove("fx-chain-dragging");
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
      window.removeEventListener("keydown", handleKey, true);
      setDrag(null);
    }

    endDragRef.current = endDrag;
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
    window.addEventListener("keydown", handleKey, true);
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
    return stack.map((device, index) => (
      <FxDevicePanel
        key={device.id}
        collapsed={collapsed.has(device.id)}
        device={device}
        dragging={drag?.deviceId === device.id}
        onContextMenu={(event) =>
          openContextMenu(event, device, index, stack.length)
        }
        onRemove={() => removeDevice(device)}
        layerBypassed={device.group === "layer" && !layerFxEnabled}
        onSetEnabled={onSetEnabled}
        layers={layers}
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
    ));
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
  const globalOrderHint = resolveGlobalOrderHint(groups.global);
  const menuDevice = menu?.device;
  const menuEntries: ContextMenuEntry[] =
    menu && menuDevice
      ? [
          {
            type: "item",
            id: "collapse",
            label: collapsed.has(menuDevice.id) ? "Expand" : "Collapse",
            onSelect: () => toggleCollapsed(menuDevice.id),
          },
          {
            type: "item",
            id: "enable",
            label: menuDevice.enabled ? "Bypass" : "Enable",
            onSelect: () => onSetEnabled(menuDevice, !menuDevice.enabled),
          },
          { type: "separator" },
          {
            type: "item",
            id: "move-left",
            label: "Move Left",
            shortcut: "Alt+←",
            disabled: menu.index === 0,
            onSelect: () =>
              moveDevice(
                menuDevice,
                menu.index,
                menu.index - 1,
                menu.stackSize,
              ),
          },
          {
            type: "item",
            id: "move-right",
            label: "Move Right",
            shortcut: "Alt+→",
            disabled: menu.index >= menu.stackSize - 1,
            onSelect: () =>
              moveDevice(
                menuDevice,
                menu.index,
                menu.index + 1,
                menu.stackSize,
              ),
          },
          { type: "separator" },
          ...(menuDevice.layerDefault
            ? [
                {
                  type: "item",
                  id: "reset",
                  label: "Reset to Default",
                  onSelect: () => resetDevice(menuDevice),
                } satisfies ContextMenuEntry,
              ]
            : [
                {
                  type: "item",
                  id: "duplicate",
                  label: "Duplicate",
                  onSelect: () => duplicateDevice(menuDevice),
                } satisfies ContextMenuEntry,
                {
                  type: "item",
                  id: "delete",
                  label: "Delete",
                  shortcut: "Del",
                  onSelect: () => removeDevice(menuDevice),
                } satisfies ContextMenuEntry,
              ]),
        ]
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
          {globalOrderHint ? (
            <p className="fx-chain__hint">{globalOrderHint}</p>
          ) : null}
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

function AddDeviceMenu({
  effects,
  focusKey,
  label,
  withLabel,
  onAdd,
  onCloseAutoFocus,
  onOpen,
}: {
  effects: readonly FxEffectDefinition[];
  focusKey: string;
  label: string;
  withLabel: boolean;
  onAdd: (effectName: string) => void;
  onCloseAutoFocus: (event: Event) => void;
  onOpen: () => void;
}) {
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) {
          onOpen();
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          aria-label={label}
          className={`fx-chain__add ${withLabel ? "fx-chain__add--labelled" : ""}`}
          data-fx-focus={focusKey}
          title={label}
          type="button"
        >
          <PlusIcon aria-hidden="true" />
          {withLabel ? <span>Add device</span> : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="fx-add-menu"
        onCloseAutoFocus={onCloseAutoFocus}
        sideOffset={6}
      >
        {effects.map((definition) => (
          <DropdownMenuItem
            key={definition.effectName}
            onSelect={() => onAdd(definition.effectName)}
          >
            <span
              aria-hidden="true"
              className="fx-add-menu__swatch"
              style={{ background: definition.accent }}
            />
            <span className="fx-add-menu__text">
              <strong>{definition.displayName}</strong>
              <span>{definition.description}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type FxDevicePanelProps = {
  device: FxDevice;
  collapsed: boolean;
  dragging: boolean;
  // Dims the device while its layer's FX are off; its own bypass is kept.
  layerBypassed?: boolean;
  onToggleCollapsed: () => void;
  onStripClick: () => void;
  onRemove: () => void;
  onTitlePointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onTitleKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  onSetEnabled: FxChainProps["onSetEnabled"];
  layers: readonly FxLayerOption[];
  onSetParameter: FxChainProps["onSetParameter"];
};

// Explains the "Not supported here" chip on a device loaded onto a stack its
// effect isn't designed for.
function getUnsupportedTitle(device: FxDevice) {
  const stack =
    device.group === "global"
      ? "the Global stack"
      : device.group === "clip"
        ? "a clip"
        : "a layer";
  return `${device.name} isn't designed for ${stack}. Remove it, or add it where it is supported.`;
}

function getTitleShortcuts(device: FxDevice) {
  return device.layerDefault
    ? "Alt+ArrowLeft Alt+ArrowRight"
    : "Alt+ArrowLeft Alt+ArrowRight Delete";
}

export function FxDevicePanel({
  device,
  collapsed,
  dragging,
  layerBypassed = false,
  onToggleCollapsed,
  onStripClick,
  onRemove,
  onTitlePointerDown,
  onTitleKeyDown,
  onContextMenu,
  onSetEnabled,
  onSetParameter,
  layers,
}: FxDevicePanelProps) {
  const style = { "--fx-accent": device.accent } as CSSProperties;
  const powerLabel = `${device.enabled ? "Bypass" : "Enable"} ${device.name}`;
  const className = [
    "fx-device-panel",
    collapsed ? "fx-device-panel--collapsed" : "",
    device.enabled ? "" : "fx-device-panel--bypassed",
    layerBypassed ? "fx-device-panel--layer-off" : "",
    dragging ? "fx-device-panel--dragging" : "",
    device.unsupported ? "fx-device-panel--unsupported" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const power = (
    <button
      aria-label={powerLabel}
      aria-pressed={device.enabled}
      className="fx-device-panel__power"
      data-fx-no-drag
      onClick={() => onSetEnabled(device, !device.enabled)}
      title={powerLabel}
      type="button"
    >
      <PowerIcon aria-hidden="true" />
    </button>
  );

  if (collapsed) {
    return (
      <section
        aria-label={device.name}
        className={className}
        data-fx-group={device.group}
        onContextMenu={onContextMenu}
        onPointerDown={onTitlePointerDown}
        style={style}
      >
        {power}
        <button
          aria-expanded={false}
          aria-keyshortcuts={getTitleShortcuts(device)}
          aria-label={`Expand ${device.name}`}
          className="fx-device-panel__strip"
          data-fx-focus={device.id}
          onClick={onStripClick}
          onKeyDown={onTitleKeyDown}
          title={`Expand ${device.name}`}
          type="button"
        >
          <span>{device.name}</span>
        </button>
      </section>
    );
  }

  // Double-clicking the title bar folds the device, except on its buttons.
  function handleTitleDoubleClick(event: ReactMouseEvent<HTMLElement>) {
    if (!(event.target as HTMLElement).closest("[data-fx-no-drag]")) {
      onToggleCollapsed();
    }
  }

  const { controls, knobs } = splitDeviceParameters(device.parameters);

  return (
    <section
      aria-label={device.name}
      className={className}
      data-fx-group={device.group}
      style={style}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: double-click and dragging are pointer shortcuts; the name button has the keyboard equivalents */}
      <header
        className="fx-device-panel__title"
        onContextMenu={onContextMenu}
        onDoubleClick={handleTitleDoubleClick}
        onPointerDown={onTitlePointerDown}
        title={device.description}
      >
        {power}
        <button
          aria-keyshortcuts={getTitleShortcuts(device)}
          aria-label={`${device.name}, drag or press Alt+Left or Alt+Right to move`}
          className="fx-device-panel__name"
          data-fx-focus={device.id}
          onKeyDown={onTitleKeyDown}
          type="button"
        >
          {device.name}
        </button>
        {device.unsupported ? (
          <span
            className="fx-device-panel__unsupported"
            title={getUnsupportedTitle(device)}
          >
            Not supported here
          </span>
        ) : null}
        {device.layerDefault ? null : (
          <button
            aria-label={`Remove ${device.name}`}
            className="fx-device-panel__remove"
            data-fx-no-drag
            onClick={onRemove}
            title={`Remove ${device.name}`}
            type="button"
          >
            <XMarkIcon aria-hidden="true" />
          </button>
        )}
        <button
          aria-expanded
          aria-label={`Collapse ${device.name}`}
          className="fx-device-panel__collapse"
          data-fx-no-drag
          onClick={onToggleCollapsed}
          title={`Collapse ${device.name}`}
          type="button"
        >
          <ChevronLeftIcon aria-hidden="true" />
        </button>
      </header>
      {device.warning ? (
        <p className="fx-device-panel__warning" role="status">
          {device.warning}
        </p>
      ) : null}
      {usesColumnLayout(controls.length) ? (
        // Too many controls for a row each: they fill columns instead,
        // with the knobs beside them.
        <div className="fx-device-panel__body fx-device-panel__body--columns">
          <div className="fx-device-panel__controls">
            {controls.map((parameter) => (
              <FxParameterControl
                key={parameter.key}
                device={device}
                layers={layers}
                onSetParameter={onSetParameter}
                parameter={parameter}
              />
            ))}
          </div>
          {knobs.length ? (
            <div className="fx-device-panel__knobs">
              {knobs.map((parameter) => (
                <FxParameterControl
                  key={parameter.key}
                  device={device}
                  layers={layers}
                  onSetParameter={onSetParameter}
                  parameter={parameter}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div
          className="fx-device-panel__body"
          style={{
            gridTemplateColumns: `repeat(${knobColumnCount(knobs.length)}, auto)`,
          }}
        >
          {device.parameters.length ? (
            [...controls, ...knobs].map((parameter) => (
              <FxParameterControl
                key={parameter.key}
                device={device}
                layers={layers}
                onSetParameter={onSetParameter}
                parameter={parameter}
              />
            ))
          ) : (
            <p className="fx-device-panel__empty">No settings</p>
          )}
        </div>
      )}
    </section>
  );
}

function FxParameterControl({
  device,
  parameter,
  onSetParameter,
  layers,
}: {
  device: FxDevice;
  parameter: FxDeviceParameter;
  layers: readonly FxLayerOption[];
  onSetParameter: FxChainProps["onSetParameter"];
}) {
  // Long option lists, such as font weights, pick from a menu instead.
  if (parameter.kind === "enum" && parameter.menu) {
    return (
      <label className="fx-select">
        <span className="fx-select__label">{parameter.label}</span>
        <select
          data-fx-no-drag
          onChange={(event) =>
            onSetParameter(device, parameter.key, event.target.value, "commit")
          }
          value={parameter.stringValue}
        >
          {parameter.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (parameter.kind === "enum") {
    return (
      <fieldset className="fx-segmented">
        <legend>{parameter.label}</legend>
        <div className="fx-segmented__options">
          {parameter.options?.map((option) => (
            <button
              aria-pressed={parameter.stringValue === option}
              key={option}
              onClick={() =>
                onSetParameter(device, parameter.key, option, "commit")
              }
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      </fieldset>
    );
  }

  if (parameter.kind === "color" || parameter.kind === "gradient") {
    return (
      <FxPaintControl
        device={device}
        onSetParameter={onSetParameter}
        parameter={parameter}
      />
    );
  }

  if (parameter.kind === "text") {
    return (
      <FxTextControl
        device={device}
        onSetParameter={onSetParameter}
        parameter={parameter}
      />
    );
  }

  if (parameter.kind === "font") {
    return (
      <FontPicker
        label={parameter.label}
        onChange={(value) =>
          onSetParameter(device, parameter.key, value, "commit")
        }
        value={parameter.stringValue ?? `${parameter.defaultValue}`}
      />
    );
  }

  if (parameter.kind === "layers") {
    return (
      <FxLayersControl
        device={device}
        layers={layers}
        onSetParameter={onSetParameter}
        parameter={parameter}
      />
    );
  }

  if (parameter.kind === "flags") {
    const value = parameter.stringValue ?? "";
    const on = new Set(value.split(","));
    return (
      <fieldset className="fx-segmented fx-flags">
        <legend>{parameter.label}</legend>
        <div className="fx-segmented__options">
          {parameter.flags?.map((flag) => (
            <button
              aria-label={flag.title}
              aria-pressed={on.has(flag.value)}
              className={`fx-flags__${flag.value.toLowerCase()}`}
              key={flag.value}
              onClick={() =>
                onSetParameter(
                  device,
                  parameter.key,
                  toggleStyleFlag(value, flag.value),
                  "commit",
                )
              }
              title={flag.title}
              type="button"
            >
              {flag.label}
            </button>
          ))}
        </div>
      </fieldset>
    );
  }

  const defaultValue =
    typeof parameter.defaultValue === "number" ? parameter.defaultValue : 0;
  return (
    <Knob
      accent={device.accent}
      bipolar={parameter.min < 0 && parameter.max > 0}
      defaultValue={defaultValue}
      format={getParameterFormat(device.effectName, parameter.key)}
      label={parameter.label}
      max={parameter.max}
      min={parameter.min}
      onChange={(value) =>
        onSetParameter(device, parameter.key, value, "transient")
      }
      onCommit={(value) =>
        onSetParameter(device, parameter.key, value, "commit")
      }
      step={parameter.step}
      value={parameter.numericValue ?? defaultValue}
    />
  );
}

// A button that opens a checkmark menu of `layers`: ticked layers are the
// ones the Order arranges. The parameter stores the unticked ones. Each
// toggle is one undo step and leaves the menu open for the next.
function FxLayersControl({
  device,
  parameter,
  layers,
  onSetParameter,
}: {
  device: FxDevice;
  parameter: FxDeviceParameter;
  layers: readonly FxLayerOption[];
  onSetParameter: FxChainProps["onSetParameter"];
}) {
  const value = parameter.stringValue ?? "";
  const excluded = new Set(parseLayerIdList(value));
  const excludedCount = layers.filter((layer) => excluded.has(layer.id)).length;
  const set = (next: string) => {
    if (next !== value) {
      onSetParameter(device, parameter.key, next, "commit");
    }
  };
  // Menu rows toggle in place instead of closing the menu.
  const keepOpen = (event: Event) => event.preventDefault();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="fx-layers__trigger" data-fx-no-drag type="button">
          {describeArrangedLayers(value, layers)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="fx-layers-menu"
        sideOffset={4}
      >
        {layers.map((layer, index) => (
          <DropdownMenuCheckboxItem
            checked={!excluded.has(layer.id)}
            className="fx-layers-menu__item"
            key={layer.id}
            onCheckedChange={() => set(toggleLayerId(value, layer.id))}
            onSelect={keepOpen}
          >
            <span className="fx-layers-menu__check">
              <DropdownMenuItemIndicator>
                <CheckIcon aria-hidden="true" />
              </DropdownMenuItemIndicator>
            </span>
            <span className="fx-layers-menu__number">{index + 1}</span>
            <span
              aria-hidden="true"
              className="fx-layers-menu__swatch"
              style={{ background: layer.color }}
            />
            <span className="fx-layers-menu__name">{layer.name}</span>
          </DropdownMenuCheckboxItem>
        ))}
        {layers.length ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem
          className="fx-layers-menu__item"
          disabled={!excludedCount}
          onSelect={(event) => {
            keepOpen(event);
            set("");
          }}
        >
          Include all
        </DropdownMenuItem>
        <DropdownMenuItem
          className="fx-layers-menu__item"
          disabled={!layers.length || excludedCount === layers.length}
          onSelect={(event) => {
            keepOpen(event);
            set(excludeAllLayers(layers));
          }}
        >
          Exclude all
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// A swatch that opens a colour or gradient picker in a popover. Picker drags
// send transient edits, and closing the popover commits the last value as
// one undo step.
function FxPaintControl({
  device,
  parameter,
  onSetParameter,
}: {
  device: FxDevice;
  parameter: FxDeviceParameter;
  onSetParameter: FxChainProps["onSetParameter"];
}) {
  const pendingRef = useRef<string | null>(null);
  const value = parameter.stringValue ?? `${parameter.defaultValue}`;
  const gradient = parameter.kind === "gradient";
  const label = `Edit ${parameter.label}`;

  return (
    <div className="fx-paint">
      <span className="fx-paint__label">{parameter.label}</span>
      <Popover
        onOpenChange={(open) => {
          const pending = pendingRef.current;
          pendingRef.current = null;
          if (!open && pending !== null) {
            onSetParameter(device, parameter.key, pending, "commit");
          }
        }}
      >
        <PopoverTrigger asChild>
          <button
            aria-label={label}
            className="fx-paint__swatch"
            data-fx-no-drag
            title={label}
            type="button"
          >
            <span aria-hidden="true" style={{ background: value }} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="fx-paint__popover">
          <ColorPicker
            disableLightMode
            hideColorTypeBtns
            hideGradientControls={!gradient}
            height={150}
            onChange={(next) => {
              pendingRef.current = next;
              onSetParameter(device, parameter.key, next, "transient");
            }}
            value={value}
            width={236}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

// A text area for free text. Typing sends transient edits, and leaving the
// field commits them as one undo step.
function FxTextControl({
  device,
  parameter,
  onSetParameter,
}: {
  device: FxDevice;
  parameter: FxDeviceParameter;
  onSetParameter: FxChainProps["onSetParameter"];
}) {
  const value = parameter.stringValue ?? "";
  const [draft, setDraft] = useState(value);
  const editingRef = useRef(false);
  const pendingRef = useRef<string | null>(null);

  // Follows edits made elsewhere, such as undo or a collaborator, except
  // while typing here.
  useEffect(() => {
    if (!editingRef.current) {
      setDraft(value);
    }
  }, [value]);

  return (
    <label className="fx-text">
      <span className="fx-text__label">{parameter.label}</span>
      <textarea
        data-fx-no-drag
        onBlur={() => {
          editingRef.current = false;
          const pending = pendingRef.current;
          pendingRef.current = null;
          if (pending !== null) {
            onSetParameter(device, parameter.key, pending, "commit");
          }
        }}
        onChange={(event) => {
          editingRef.current = true;
          pendingRef.current = event.target.value;
          setDraft(event.target.value);
          onSetParameter(
            device,
            parameter.key,
            event.target.value,
            "transient",
          );
        }}
        onFocus={() => {
          editingRef.current = true;
        }}
        rows={3}
        spellCheck={false}
        value={draft}
      />
    </label>
  );
}
