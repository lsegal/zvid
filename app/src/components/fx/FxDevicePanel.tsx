import {
  ChevronLeftIcon,
  MusicalNoteIcon,
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
import { useRef } from "react";
import { isMoveEffectName } from "../../fx/effects/move/move.ts";
import {
  type FxLayerOption,
  isPinnedDevice,
  knobColumnCount,
  splitDeviceParameters,
  splitKnobRows,
  usesColumnLayout,
} from "../../fx-chain";
import type { FxDevice, FxDeviceParameter } from "../../fx-stack";
import { MotionIcon } from "../MotionIcon";
import type { FxChainProps } from "./FxChain";
import { FxParameterControl } from "./FxParameterControl";
import { useKeyMapControls } from "./key-map-context";
import { MoveDeviceBody } from "./MoveDeviceBody";
import { useDeviceFit } from "./use-device-fit";
import "./fx-device-audio.css";
import "./fx-device-layouts.css";
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
  // Whether it is the one effect selected for other features to target.
  selected?: boolean;
  // Absent while attached, when the wrapper takes the clicks.
  onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
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

// Levels and Scopes keep their arrangement on a short panel, and their own
// controls get shorter: the curve keeps its tab, and the scope its canvas.
function shrinksInPlace(device: FxDevice) {
  return device.parameters.some(
    ({ kind }) => kind === "curve" || kind === "waveform",
  );
}

// How many layouts a device has for a short panel, its usual one first. Most
// put the controls beside the knobs, then the knobs in one row, then the
// controls in fewer rows too; labeled knob rows go side by side instead.
function getLayoutCount(device: FxDevice, labeledRows: boolean) {
  if (!device.parameters.length) {
    return 1;
  }
  if (shrinksInPlace(device)) {
    return 3;
  }
  if (!labeledRows) {
    return 4;
  }
  return isMoveEffectName(device.effectName) ? 2 : 3;
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
  selected = false,
  onClick,
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
  const keyMap = useKeyMapControls();
  const sectionRef = useRef<HTMLElement>(null);
  const { controls, knobs } = splitDeviceParameters(device.parameters);
  const knobRows = splitKnobRows(knobs, device.knobRows);
  const layout = useDeviceFit(
    sectionRef,
    `${device.parameters.map((parameter) => parameter.key).join()}|${Boolean(device.warning)}`,
    getLayoutCount(device, knobRows !== undefined),
    !collapsed,
  );
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
    selected ? "fx-device-panel--selected" : "",
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
      {...keyMap.buttonProps({ kind: "power", effectId: device.id })}
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
      {...keyMap.buttonProps({ kind: "modifier", effectId: device.id })}
    >
      <MotionIcon />
    </button>
  ) : null;
  // Tells audio devices, such as Gain, and MIDI ones, such as Synth, from
  // the video ones beside them.
  const domainLabel =
    device.domain === "audio"
      ? "Audio effect"
      : device.domain === "midi"
        ? "MIDI effect"
        : undefined;
  const audioBadge = domainLabel ? (
    <span
      aria-label={domainLabel}
      className="fx-device-panel__audio"
      role="img"
      title={domainLabel}
    >
      {device.domain === "midi" ? (
        <MusicalNoteIcon aria-hidden="true" />
      ) : (
        <SpeakerWaveIcon aria-hidden="true" />
      )}
    </span>
  ) : null;
  // While attached, the wrapper around the device and its Animation or
  // Modulation section is the stack's panel.
  const groupAttribute = attached ? {} : { "data-fx-group": device.group };

  if (collapsed) {
    return (
      // biome-ignore lint/a11y/useKeyWithClickEvents: the strip button handles the keyboard
      <section
        aria-label={device.name}
        className={className}
        {...groupAttribute}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onPointerDown={onTitlePointerDown}
        style={style}
      >
        {power}
        {animationToggle}
        <button
          aria-current={selected || undefined}
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

  const renderControl = (parameter: FxDeviceParameter) => (
    <FxParameterControl
      key={parameter.key}
      device={device}
      layers={layers}
      layout={layout}
      onSetParameter={onSetParameter}
      parameter={parameter}
    />
  );
  const knobRowsGrid = knobRows?.map((row) => (
    <fieldset className="fx-device-panel__knob-row" key={row.label}>
      <legend className="fx-device-panel__row-label">{row.label}</legend>
      {row.knobs.map(renderControl)}
    </fieldset>
  ));

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the name button handles the keyboard
    <section
      aria-label={device.name}
      className={className}
      data-fx-layout={layout || undefined}
      onClick={onClick}
      ref={sectionRef}
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
          aria-current={selected || undefined}
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
      {usesColumnLayout(controls.length) ||
      (layout > 0 && !knobRows && !shrinksInPlace(device)) ? (
        // Too many controls for a row each, or too short a panel: they fill
        // columns instead, with the knobs beside them.
        <div className="fx-device-panel__body fx-device-panel__body--columns">
          {controls.length ? (
            <div className="fx-device-panel__controls">
              {controls.map(renderControl)}
            </div>
          ) : null}
          {knobs.length ? (
            <div className="fx-device-panel__knobs">
              {knobs.map(renderControl)}
            </div>
          ) : null}
        </div>
      ) : knobRows && isMoveEffectName(device.effectName) ? (
        <MoveDeviceBody
          beside={layout > 0}
          device={device}
          controls={controls}
          knobRows={knobRows}
          layers={layers}
          onSetParameter={onSetParameter}
        />
      ) : knobRows && layout > 0 ? (
        // The controls beside the labeled rows, which then sit side by side.
        <div className="fx-device-panel__body fx-device-panel__body--columns">
          {controls.length ? (
            <div className="fx-device-panel__controls">
              {controls.map(renderControl)}
            </div>
          ) : null}
          <div
            className="fx-device-panel__rows"
            style={{
              gridTemplateColumns: (layout > 1
                ? knobRows
                : knobRows.slice(0, 1)
              )
                .map((row) => `auto repeat(${row.knobs.length}, auto)`)
                .join(" "),
            }}
          >
            {knobRowsGrid}
          </div>
        </div>
      ) : knobRows ? (
        // Labeled knob rows, each led by its label.
        <div
          className="fx-device-panel__body"
          style={{
            gridTemplateColumns: `auto repeat(${knobRows[0].knobs.length}, auto)`,
          }}
        >
          {controls.map(renderControl)}
          {knobRowsGrid}
        </div>
      ) : (
        <div
          className="fx-device-panel__body"
          style={{
            gridTemplateColumns: `repeat(${device.knobColumns ?? knobColumnCount(knobs.length)}, auto)`,
          }}
        >
          {device.parameters.length ? (
            [...controls, ...knobs].map(renderControl)
          ) : (
            <p className="fx-device-panel__empty">No settings</p>
          )}
        </div>
      )}
    </section>
  );
}
