import {
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
import {
  describeDeviceMove,
  dropSlotToStackIndex,
  getAutoScrollDelta,
  getDropSlot,
  getParameterFormat,
  groupChainDevices,
  isNoopDropSlot,
  knobColumnCount,
  readCollapsedDevices,
  toggleCollapsedDevice,
  writeCollapsedDevices,
} from "../fx-chain";
import { FX_EFFECT_DEFINITIONS } from "../fx-registry";
import {
  type FxDevice,
  type FxDeviceGroup,
  type FxDeviceParameter,
  GLOBAL_EFFECT_TRACK_ID,
} from "../fx-stack";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Knob } from "./ui/Knob";
import "./fx-chain.css";

export type FxEditMode = "commit" | "transient";

type FxChainProps = {
  devices: FxDevice[];
  kind: string | undefined;
  // Track id of the selected layer's stack; undefined when none is.
  layerTrackId: string | undefined;
  // Name of the selected layer, such as "Layer 3"; undefined when none is.
  layerName: string | undefined;
  // False when the selected layer's FX badge bypasses its whole stack.
  layerFxEnabled?: boolean;
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

function getTrackId(group: FxDeviceGroup, layerTrackId: string | undefined) {
  return group === "global" ? GLOBAL_EFFECT_TRACK_ID : layerTrackId;
}

export function FxChain({
  devices,
  kind,
  layerTrackId,
  layerName,
  layerFxEnabled = true,
  onSetLayerFxEnabled,
  onSetEnabled,
  onSetParameter,
  onMove,
  onAdd,
  onRemove,
  onDuplicate,
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
    const stack = groups[device.group];
    const index = stack.findIndex((candidate) => candidate.id === device.id);
    const neighbour = stack[index + 1] ?? stack[index - 1];
    requestFocus(neighbour?.id ?? `add-${device.group}`);
    onRemove(device);
    setAnnouncement(`Removed ${device.name}`);
  }

  function duplicateDevice(device: FxDevice) {
    const id = crypto.randomUUID();
    requestFocus(id);
    onDuplicate(device, id);
    setAnnouncement(`Duplicated ${device.name}`);
  }

  function addDevice(group: FxDeviceGroup, effectName: string) {
    const trackId = getTrackId(group, layerTrackId);
    const definition = FX_EFFECT_DEFINITIONS.find(
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
    const divider = scroller
      .querySelector<HTMLElement>(".fx-chain__divider")
      ?.getBoundingClientRect();
    const dividerX = divider ? divider.left + divider.width / 2 : undefined;
    const overOtherStack =
      dividerX !== undefined &&
      (group === "layer" ? pointerX > dividerX : pointerX < dividerX);

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
    const label = `Add device to ${group === "global" ? "Global" : "this layer"}`;
    return (
      <AddDeviceMenu
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

  const layerEmpty = !groups.layer.length;
  const emptyMessage = !layerName
    ? "Select a layer to see its effects"
    : layerEmpty
      ? `No effects on ${layerName}`
      : null;
  const showGlobal = groups.global.length > 0 || canEdit;
  const menuDevice = menu?.device;

  return (
    <div
      className={`fx-chain ${drag ? "fx-chain--dragging" : ""}`}
      ref={scrollRef}
    >
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
      {showGlobal ? (
        <>
          <div className="fx-chain__divider">
            <span>Global</span>
          </div>
          {renderStack("global")}
          {canEdit ? renderAddMenu("global") : null}
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
      <DropdownMenu
        onOpenChange={(open) => {
          if (!open) {
            setMenu(null);
          }
        }}
        open={Boolean(menu)}
      >
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden="true"
            className="fx-chain__menu-anchor"
            style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          aria-label={menuDevice ? `${menuDevice.name} actions` : undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!focusAfterMenu() && menuDeviceIdRef.current) {
              focusTitle(menuDeviceIdRef.current);
            }
          }}
          sideOffset={2}
        >
          {menu && menuDevice ? (
            <>
              <DropdownMenuItem onSelect={() => toggleCollapsed(menuDevice.id)}>
                {collapsed.has(menuDevice.id) ? "Expand" : "Collapse"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => onSetEnabled(menuDevice, !menuDevice.enabled)}
              >
                {menuDevice.enabled ? "Bypass" : "Enable"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={menu.index === 0}
                onSelect={() =>
                  moveDevice(
                    menuDevice,
                    menu.index,
                    menu.index - 1,
                    menu.stackSize,
                  )
                }
              >
                Move Left
                <DropdownMenuShortcut>Alt+←</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={menu.index >= menu.stackSize - 1}
                onSelect={() =>
                  moveDevice(
                    menuDevice,
                    menu.index,
                    menu.index + 1,
                    menu.stackSize,
                  )
                }
              >
                Move Right
                <DropdownMenuShortcut>Alt+→</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => duplicateDevice(menuDevice)}>
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => removeDevice(menuDevice)}>
                Delete
                <DropdownMenuShortcut>Del</DropdownMenuShortcut>
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function AddDeviceMenu({
  focusKey,
  label,
  withLabel,
  onAdd,
  onCloseAutoFocus,
  onOpen,
}: {
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
        {FX_EFFECT_DEFINITIONS.map((definition) => (
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
  onSetParameter: FxChainProps["onSetParameter"];
};

const TITLE_SHORTCUTS = "Alt+ArrowLeft Alt+ArrowRight Delete";

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
}: FxDevicePanelProps) {
  const style = { "--fx-accent": device.accent } as CSSProperties;
  const powerLabel = `${device.enabled ? "Bypass" : "Enable"} ${device.name}`;
  const className = [
    "fx-device-panel",
    collapsed ? "fx-device-panel--collapsed" : "",
    device.enabled ? "" : "fx-device-panel--bypassed",
    layerBypassed ? "fx-device-panel--layer-off" : "",
    dragging ? "fx-device-panel--dragging" : "",
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
          aria-keyshortcuts={TITLE_SHORTCUTS}
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
          aria-keyshortcuts={TITLE_SHORTCUTS}
          aria-label={`${device.name}, drag or press Alt+Left or Alt+Right to move`}
          className="fx-device-panel__name"
          data-fx-focus={device.id}
          onKeyDown={onTitleKeyDown}
          type="button"
        >
          {device.name}
        </button>
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
      <div
        className="fx-device-panel__body"
        style={{
          gridTemplateColumns: `repeat(${knobColumnCount(device.parameters.length)}, auto)`,
        }}
      >
        {device.parameters.length ? (
          device.parameters.map((parameter) => (
            <FxParameterControl
              key={parameter.key}
              device={device}
              onSetParameter={onSetParameter}
              parameter={parameter}
            />
          ))
        ) : (
          <p className="fx-device-panel__empty">No settings</p>
        )}
      </div>
    </section>
  );
}

function FxParameterControl({
  device,
  parameter,
  onSetParameter,
}: {
  device: FxDevice;
  parameter: FxDeviceParameter;
  onSetParameter: FxChainProps["onSetParameter"];
}) {
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
