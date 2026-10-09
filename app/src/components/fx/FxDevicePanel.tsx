import {
  ChevronLeftIcon,
  PowerIcon,
  SpeakerWaveIcon,
  XMarkIcon,
} from "@heroicons/react/24/solid";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  type FxLayerOption,
  isPinnedDevice,
  knobColumnCount,
  splitDeviceParameters,
  splitKnobRows,
  usesColumnLayout,
} from "../../fx-chain";
import type { FxDevice } from "../../fx-stack";
import { MotionIcon } from "../MotionIcon";
import type { FxChainProps } from "./FxChain";
import { FxParameterControl } from "./FxParameterControl";
import "./fx-device-audio.css";
import "./fx-device-pinned.css";

type FxDevicePanelProps = {
  device: FxDevice;
  // True while its Animation or Modulation section is attached to its right
  // edge; the wrapper around the pair is then the stack's panel.
  attached?: boolean;
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
  onSetAnimationEnabled?: FxChainProps["onSetAnimationEnabled"];
  onSetModulationEnabled?: FxChainProps["onSetModulationEnabled"];
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

const MOVE_SHORTCUTS =
  "Alt+ArrowLeft Alt+ArrowRight Alt+Shift+ArrowLeft Alt+Shift+ArrowRight";

// A clip's content device can't move, and a layer's Layout can't be deleted.
function getTitleShortcuts(device: FxDevice) {
  const move = isPinnedDevice(device) ? [] : [MOVE_SHORTCUTS];
  return [...move, ...(device.layerDefault ? [] : ["Delete"])].join(" ");
}

function getTitleLabel(device: FxDevice) {
  return isPinnedDevice(device)
    ? device.name
    : `${device.name}, drag or press Alt+Left or Alt+Right to move, with Shift to move to another stack`;
}

export function FxDevicePanel({
  device,
  attached = false,
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
  onSetAnimationEnabled,
  onSetModulationEnabled,
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
    attached ? "fx-device-panel--attached" : "",
    isPinnedDevice(device) ? "fx-device-panel--pinned" : "",
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
  // Video effects carry Animation and audio effects Modulation. Layout,
  // Reverse, and effects the app doesn't know, have neither.
  const modifier = device.supportsAnimation
    ? {
        name: "Animation",
        on: device.animation?.enabled === true,
        setEnabled: onSetAnimationEnabled,
      }
    : device.supportsModulation
      ? {
          name: "Modulation",
          on: device.modulation?.enabled === true,
          setEnabled: onSetModulationEnabled,
        }
      : undefined;
  const modifierLabel = modifier
    ? `Turn ${modifier.name} ${modifier.on ? "Off" : "On"} for ${device.name}`
    : "";
  const animationToggle = modifier ? (
    <button
      aria-label={modifierLabel}
      aria-pressed={modifier.on}
      className="fx-device-panel__animate"
      data-fx-no-drag
      onClick={() => modifier.setEnabled?.(device, !modifier.on)}
      title={modifierLabel}
      type="button"
    >
      <MotionIcon />
    </button>
  ) : null;
  // Tells audio devices, such as Gain, from the video ones beside them.
  const audioBadge =
    device.domain === "audio" ? (
      <span
        aria-label="Audio effect"
        className="fx-device-panel__audio"
        role="img"
        title="Audio effect"
      >
        <SpeakerWaveIcon aria-hidden="true" />
      </span>
    ) : null;
  // While attached, the wrapper around the device and its Animation or
  // Modulation section is the stack's panel.
  const groupAttribute = attached ? {} : { "data-fx-group": device.group };

  if (collapsed) {
    return (
      <section
        aria-label={device.name}
        className={className}
        {...groupAttribute}
        onContextMenu={onContextMenu}
        onPointerDown={onTitlePointerDown}
        style={style}
      >
        {power}
        {animationToggle}
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
        {audioBadge}
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
  const knobRows = splitKnobRows(knobs, device.knobRows);

  return (
    <section
      aria-label={device.name}
      className={className}
      {...groupAttribute}
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
        {animationToggle}
        <button
          aria-keyshortcuts={getTitleShortcuts(device)}
          aria-label={getTitleLabel(device)}
          className="fx-device-panel__name"
          data-fx-focus={device.id}
          onKeyDown={onTitleKeyDown}
          type="button"
        >
          {device.name}
        </button>
        {audioBadge}
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
      ) : knobRows ? (
        // Labeled knob rows (a Move's Start and End), each led by its label.
        <div
          className="fx-device-panel__body"
          style={{
            gridTemplateColumns: `auto repeat(${knobRows[0].knobs.length}, auto)`,
          }}
        >
          {controls.map((parameter) => (
            <FxParameterControl
              key={parameter.key}
              device={device}
              layers={layers}
              onSetParameter={onSetParameter}
              parameter={parameter}
            />
          ))}
          {knobRows.map((row) => (
            <fieldset className="fx-device-panel__knob-row" key={row.label}>
              <legend className="fx-device-panel__row-label">
                {row.label}
              </legend>
              {row.knobs.map((parameter) => (
                <FxParameterControl
                  key={parameter.key}
                  device={device}
                  layers={layers}
                  onSetParameter={onSetParameter}
                  parameter={parameter}
                />
              ))}
            </fieldset>
          ))}
        </div>
      ) : (
        <div
          className="fx-device-panel__body"
          style={{
            gridTemplateColumns: `repeat(${device.knobColumns ?? knobColumnCount(knobs.length)}, auto)`,
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
