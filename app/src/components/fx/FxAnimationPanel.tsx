import { CheckIcon, ChevronLeftIcon } from "@heroicons/react/24/solid";
import type { CSSProperties } from "react";
import {
  ANIMATION_TIMINGS,
  type AnimatableParameter,
  CLIP_MOTIONS,
  createDefaultAnimation,
  describeAnimatedParameters,
  type EffectAnimation,
  getAnimatableParameters,
  getAnimationModes,
  getClipTimings,
  LFO_DEPTH_STEP,
  LFO_MAX_PHASE,
  LFO_MAX_RATE,
  LFO_MIN_RATE,
  LFO_SHAPES,
  LFO_SYNC_RATES,
  type LfoAnimation,
  ORDER_TRANSITIONS,
  REACTIVE_MOTIONS,
  REACTIVITY_STEP,
  toggleAnimatedParameter,
} from "../../fx-animation-defaults";
import {
  isTransitionEffectName,
  TYPE_KEY,
} from "../../fx/effects/transition/transition";
import type { FxDevice } from "../../fx-stack";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItemIndicator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Knob } from "../ui/Knob";
import { Select } from "../ui/select";
import type { FxChainProps } from "./FxChain";
import type { FxEditMode, FxSetParameter } from "./types";

type FxAnimationPanelProps = {
  device: FxDevice;
  animation: EffectAnimation;
  collapsed: boolean;
  // Dims the section along with its bypassed device.
  bypassed: boolean;
  onToggleCollapsed: () => void;
  onSetAnimation?: FxChainProps["onSetAnimation"];
  // Sets a Transition's Type, which its Animation section shows with the
  // timing it blends over.
  onSetParameter?: FxSetParameter;
};

const ANIMATION_MODE_LABELS = {
  clip: "Clip",
  reactive: "Reactive",
  lfo: "LFO",
} as const;

const LFO_SYNC_OPTIONS = ["Off", "On"] as const;

// The Animation section attached to a device's right edge while its
// Animation toggle is on. It folds into a strip of its own, like a device does.
export function FxAnimationPanel({
  device,
  animation,
  collapsed,
  bypassed,
  onToggleCollapsed,
  onSetAnimation,
  onSetParameter,
}: FxAnimationPanelProps) {
  const style = { "--fx-accent": device.accent } as CSSProperties;
  const label = `${device.name} animation`;
  const className = [
    "fx-animation-panel",
    collapsed ? "fx-animation-panel--collapsed" : "",
    bypassed ? "fx-animation-panel--bypassed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (collapsed) {
    return (
      <section aria-label={label} className={className} style={style}>
        <button
          aria-expanded={false}
          aria-label={`Expand ${label}`}
          className="fx-device-panel__strip"
          onClick={onToggleCollapsed}
          title={`Expand ${label}`}
          type="button"
        >
          <span>Animation</span>
        </button>
      </section>
    );
  }

  const set = (next: EffectAnimation, mode: FxEditMode = "commit") =>
    onSetAnimation?.(device, next, mode);
  const setClip = (patch: Partial<EffectAnimation["clip"]>) =>
    set({ ...animation, clip: { ...animation.clip, ...patch } });
  const transitionType = isTransitionEffectName(device.effectName)
    ? device.parameters.find((parameter) => parameter.key === TYPE_KEY)
    : undefined;
  // Effects with a single mode, like Order's Clip, show no Mode choice.
  const modes = getAnimationModes(device.effectName);
  const reactive =
    animation.mode === "reactive" && modes.includes("reactive")
      ? animation.reactive
      : undefined;
  const setReactive = (
    patch: Partial<NonNullable<EffectAnimation["reactive"]>>,
    mode: FxEditMode = "commit",
  ) => {
    if (reactive) {
      set({ ...animation, reactive: { ...reactive, ...patch } }, mode);
    }
  };
  const lfo =
    animation.mode === "lfo" && modes.includes("lfo")
      ? animation.lfo
      : undefined;
  const setLfo = (
    patch: Partial<LfoAnimation>,
    mode: FxEditMode = "commit",
  ) => {
    if (lfo) {
      set({ ...animation, lfo: { ...lfo, ...patch } }, mode);
    }
  };

  return (
    <section aria-label={label} className={className} style={style}>
      <header className="fx-animation-panel__title">
        <span className="fx-animation-panel__name">Animation</span>
        <button
          aria-expanded
          aria-label={`Collapse ${label}`}
          className="fx-device-panel__collapse"
          onClick={onToggleCollapsed}
          title={`Collapse ${label}`}
          type="button"
        >
          <ChevronLeftIcon aria-hidden="true" />
        </button>
      </header>
      <div className="fx-animation-panel__body">
        {modes.length > 1 ? (
          <FxAnimationSegmented
            label="Mode"
            onChange={(mode) => set({ ...animation, mode })}
            optionLabel={(mode) => ANIMATION_MODE_LABELS[mode]}
            options={modes}
            value={animation.mode}
          />
        ) : null}
        {lfo ? (
          <FxLfoControls device={device} lfo={lfo} onChange={setLfo} />
        ) : !reactive ? (
          <>
            <FxAnimationSegmented
              label="Timing"
              onChange={(timing) => setClip({ timing })}
              options={getClipTimings(device.effectName)}
              value={animation.clip.timing}
            />
            {/* An Order eases its clips' slides itself, so it has a
                Transition instead of Motion In and Out. */}
            {animation.clip.transition ? (
              <FxAnimationSegmented
                label="Transition"
                onChange={(transition) => setClip({ transition })}
                options={ORDER_TRANSITIONS}
                value={animation.clip.transition}
              />
            ) : (
              <>
                <FxAnimationSelect
                  label="Motion In"
                  onChange={(motionIn) => setClip({ motionIn })}
                  options={CLIP_MOTIONS}
                  value={animation.clip.motionIn}
                />
                <FxAnimationSelect
                  label="Motion Out"
                  onChange={(motionOut) => setClip({ motionOut })}
                  options={CLIP_MOTIONS}
                  value={animation.clip.motionOut}
                />
              </>
            )}
            {transitionType?.options ? (
              <FxAnimationSelect
                label="Type"
                onChange={(type) =>
                  onSetParameter?.(device, TYPE_KEY, type, "commit")
                }
                options={transitionType.options}
                value={transitionType.stringValue ?? transitionType.display}
              />
            ) : null}
          </>
        ) : (
          <>
            <FxAnimationSegmented
              label="Timing"
              onChange={(timing) => setReactive({ timing })}
              options={ANIMATION_TIMINGS}
              value={reactive.timing}
            />
            <div className="fx-animation-panel__knob">
              <Knob
                accent={device.accent}
                defaultValue={
                  createDefaultAnimation(device.effectName)?.reactive
                    ?.reactivity ?? 0.5
                }
                format={formatReactivity}
                label="Reactivity"
                max={1}
                min={0}
                onChange={(reactivity) =>
                  setReactive({ reactivity }, "transient")
                }
                onCommit={(reactivity) => setReactive({ reactivity })}
                step={REACTIVITY_STEP}
                value={reactive.reactivity}
              />
            </div>
            <FxAnimationSelect
              label="Motion"
              onChange={(motion) => setReactive({ motion })}
              options={REACTIVE_MOTIONS}
              value={reactive.motion}
            />
            <FxAnimatedParametersControl
              device={device}
              onChange={(parameters) => setReactive({ parameters })}
              selected={reactive.parameters}
            />
          </>
        )}
      </div>
    </section>
  );
}

export function formatReactivity(value: number) {
  return value.toFixed(1);
}

function formatRate(value: number) {
  return `${value.toFixed(2)} Hz`;
}

function formatPhase(value: number) {
  return `${Math.round(value)}°`;
}

// LFO mode's controls: Sync and Shape, the Parameters it moves, then the
// Rate (a note value while synced, Hz while free), Depth and Phase. An audio
// device's Modulation passes its own knobs and defaults.
export function FxLfoControls({
  device,
  lfo,
  onChange,
  available,
  defaults = createDefaultAnimation(device.effectName)?.lfo,
}: {
  device: FxDevice;
  lfo: LfoAnimation;
  onChange: (patch: Partial<LfoAnimation>, mode?: FxEditMode) => void;
  available?: readonly AnimatableParameter[];
  defaults?: LfoAnimation;
}) {
  return (
    <>
      <FxAnimationSegmented
        label="Sync"
        onChange={(option) => onChange({ sync: option === "On" })}
        options={LFO_SYNC_OPTIONS}
        value={lfo.sync ? "On" : "Off"}
      />
      <FxAnimationSelect
        label="Shape"
        onChange={(shape) => onChange({ shape })}
        options={LFO_SHAPES}
        value={lfo.shape}
      />
      <FxAnimatedParametersControl
        available={available}
        device={device}
        onChange={(parameters) => onChange({ parameters })}
        selected={lfo.parameters}
      />
      <div className="fx-animation-panel__knob">
        {lfo.sync ? (
          <FxAnimationSelect
            label="Rate"
            onChange={(syncRate) => onChange({ syncRate })}
            options={LFO_SYNC_RATES}
            value={lfo.syncRate}
          />
        ) : (
          <Knob
            accent={device.accent}
            defaultValue={defaults?.rate ?? 1}
            format={formatRate}
            label="Rate"
            max={LFO_MAX_RATE}
            min={LFO_MIN_RATE}
            onChange={(rate) => onChange({ rate }, "transient")}
            onCommit={(rate) => onChange({ rate })}
            step={0.01}
            taper="log"
            value={lfo.rate}
          />
        )}
      </div>
      <div className="fx-animation-panel__knob">
        <Knob
          accent={device.accent}
          defaultValue={defaults?.depth ?? 0.5}
          format={formatReactivity}
          label="Depth"
          max={1}
          min={0}
          onChange={(depth) => onChange({ depth }, "transient")}
          onCommit={(depth) => onChange({ depth })}
          step={LFO_DEPTH_STEP}
          value={lfo.depth}
        />
      </div>
      <div className="fx-animation-panel__knob">
        <Knob
          accent={device.accent}
          defaultValue={defaults?.phase ?? 0}
          format={formatPhase}
          label="Phase"
          max={LFO_MAX_PHASE}
          min={0}
          onChange={(phase) => onChange({ phase }, "transient")}
          onCommit={(phase) => onChange({ phase })}
          step={1}
          value={lfo.phase}
        />
      </div>
    </>
  );
}

export function FxAnimationSegmented<T extends string>({
  label,
  options,
  value,
  onChange,
  optionLabel = (option) => option,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  optionLabel?: (option: T) => string;
}) {
  return (
    <fieldset className="fx-segmented">
      <legend>{label}</legend>
      <div className="fx-segmented__options">
        {options.map((option) => (
          <button
            aria-pressed={value === option}
            key={option}
            onClick={() => {
              if (option !== value) {
                onChange(option);
              }
            }}
            type="button"
          >
            {optionLabel(option)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function FxAnimationSelect<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="fx-select">
      <span className="fx-select__label">{label}</span>
      <Select
        aria-label={label}
        data-fx-no-drag
        onValueChange={onChange}
        options={options.map((option) => ({ value: option, label: option }))}
        value={value}
      />
    </div>
  );
}

// A button that opens a checkmark menu of the effect's knobs: ticked knobs
// are the ones Reactive or LFO mode modulates. Each toggle is one undo step and
// leaves the menu open for the next, like an Order's Layers menu.
// `available` lists the knobs to offer, the effect's animatable ones unless
// given.
export function FxAnimatedParametersControl({
  device,
  selected,
  onChange,
  available = getAnimatableParameters(device.effectName),
}: {
  device: FxDevice;
  selected: readonly string[];
  onChange: (parameters: string[]) => void;
  available?: readonly AnimatableParameter[];
}) {
  const keepOpen = (event: Event) => event.preventDefault();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="fx-layers__trigger fx-animation-panel__parameters"
          disabled={!available.length}
          type="button"
        >
          {describeAnimatedParameters(selected, available)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="fx-layers-menu"
        sideOffset={4}
      >
        {available.map((parameter) => (
          <DropdownMenuCheckboxItem
            checked={selected.includes(parameter.key)}
            className="fx-layers-menu__item"
            key={parameter.key}
            onCheckedChange={() =>
              onChange(
                toggleAnimatedParameter(selected, parameter.key, available),
              )
            }
            onSelect={keepOpen}
          >
            <span className="fx-layers-menu__check">
              <DropdownMenuItemIndicator>
                <CheckIcon aria-hidden="true" />
              </DropdownMenuItemIndicator>
            </span>
            <span className="fx-layers-menu__name">{parameter.label}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
