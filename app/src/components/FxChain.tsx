import { ChevronLeftIcon, PowerIcon } from "@heroicons/react/24/solid";
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  getParameterFormat,
  groupChainDevices,
  knobColumnCount,
  readCollapsedDevices,
  toggleCollapsedDevice,
  writeCollapsedDevices,
} from "../fx-chain";
import type { FxDevice, FxDeviceParameter } from "../fx-stack";
import { Knob } from "./ui/Knob";
import "./fx-chain.css";

export type FxEditMode = "commit" | "transient";

type FxChainProps = {
  devices: FxDevice[];
  hasClip: boolean;
  kind: string | undefined;
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
};

function getStorage() {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function FxChain({
  devices,
  hasClip,
  kind,
  layerFxEnabled = true,
  onSetLayerFxEnabled,
  onSetEnabled,
  onSetParameter,
}: FxChainProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(() =>
    readCollapsedDevices(getStorage()),
  );
  const groups = groupChainDevices(devices, kind);

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

  function toggleCollapsed(deviceId: string) {
    setCollapsed((current) => {
      const next = toggleCollapsedDevice(current, deviceId);
      writeCollapsedDevices(getStorage(), next);
      return next;
    });
  }

  function renderPanel(device: FxDevice) {
    return (
      <FxDevicePanel
        key={device.id}
        collapsed={collapsed.has(device.id)}
        device={device}
        layerBypassed={device.group === "layer" && !layerFxEnabled}
        onSetEnabled={onSetEnabled}
        onSetParameter={onSetParameter}
        onToggleCollapsed={() => toggleCollapsed(device.id)}
      />
    );
  }

  const emptyMessage = !hasClip
    ? "Select a clip to see its effects"
    : groups.layer.length
      ? null
      : "No effects on this layer";

  return (
    <div className="fx-chain" ref={scrollRef}>
      {emptyMessage ? <p className="fx-chain__empty">{emptyMessage}</p> : null}
      {groups.layer.length && !layerFxEnabled ? (
        <div className="fx-chain__layer-off">
          <span>Layer FX off</span>
          <button onClick={() => onSetLayerFxEnabled?.(true)} type="button">
            On
          </button>
        </div>
      ) : null}
      {groups.layer.map(renderPanel)}
      {groups.global.length ? (
        <>
          <div className="fx-chain__divider">
            <span>Global</span>
          </div>
          {groups.global.map(renderPanel)}
        </>
      ) : null}
    </div>
  );
}

type FxDevicePanelProps = {
  device: FxDevice;
  collapsed: boolean;
  // Dims the device while its layer's FX are off; its own bypass is kept.
  layerBypassed?: boolean;
  onToggleCollapsed: () => void;
  onSetEnabled: FxChainProps["onSetEnabled"];
  onSetParameter: FxChainProps["onSetParameter"];
};

export function FxDevicePanel({
  device,
  collapsed,
  layerBypassed = false,
  onToggleCollapsed,
  onSetEnabled,
  onSetParameter,
}: FxDevicePanelProps) {
  const bypassClassName = [
    device.enabled ? "" : "fx-device-panel--bypassed",
    layerBypassed ? "fx-device-panel--layer-off" : "",
  ].join(" ");
  const style = { "--fx-accent": device.accent } as CSSProperties;
  const powerLabel = `${device.enabled ? "Bypass" : "Enable"} ${device.name}`;
  const power = (
    <button
      aria-label={powerLabel}
      aria-pressed={device.enabled}
      className="fx-device-panel__power"
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
        className={`fx-device-panel fx-device-panel--collapsed ${bypassClassName}`}
        style={style}
      >
        {power}
        <button
          aria-expanded={false}
          aria-label={`Expand ${device.name}`}
          className="fx-device-panel__strip"
          onClick={onToggleCollapsed}
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
    if (!(event.target as HTMLElement).closest("button")) {
      onToggleCollapsed();
    }
  }

  return (
    <section
      aria-label={device.name}
      className={`fx-device-panel ${bypassClassName}`}
      style={style}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: double-click is a mouse shortcut; the collapse button is the keyboard equivalent */}
      <header
        className="fx-device-panel__title"
        onDoubleClick={handleTitleDoubleClick}
        title={device.description}
      >
        {power}
        <strong>{device.name}</strong>
        <button
          aria-expanded
          aria-label={`Collapse ${device.name}`}
          className="fx-device-panel__collapse"
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
