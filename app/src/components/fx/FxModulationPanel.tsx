import { ChevronLeftIcon } from "@heroicons/react/24/solid";
import type { CSSProperties } from "react";
import { formatDegrees, formatPercent } from "../../fx/params";
import {
  ANIMATION_TIMINGS,
  REACTIVE_MOTIONS,
  REACTIVITY_STEP,
} from "../../fx-animation-defaults";
import {
  createDefaultModulation,
  type EffectModulation,
  getModulatableParameters,
  LFO_NOTE_OPTIONS,
  LFO_PHASE_MAX,
  LFO_RATE_MAX,
  LFO_RATE_MIN,
  LFO_SHAPES,
  MODULATION_MODE_LABELS,
  MODULATION_MODES,
} from "../../fx-modulation-defaults";
import type { FxDevice } from "../../fx-stack";
import { Knob } from "../ui/Knob";
import {
  FxAnimatedParametersControl,
  FxAnimationSegmented,
  FxAnimationSelect,
  formatReactivity,
} from "./FxAnimationPanel";
import type { FxChainProps } from "./FxChain";
import type { FxEditMode } from "./types";

type FxModulationPanelProps = {
  device: FxDevice;
  modulation: EffectModulation;
  collapsed: boolean;
  // Dims the section along with its bypassed device.
  bypassed: boolean;
  onToggleCollapsed: () => void;
  onSetModulation?: FxChainProps["onSetModulation"];
};

const SYNC_OPTIONS = ["Off", "On"] as const;

function formatRate(hz: number) {
  return `${hz < 1 ? hz.toFixed(2) : hz.toFixed(1)} Hz`;
}

// The Modulation section attached to an audio device's right edge while its
// Modulation toggle is on: the audio side's Animation section, built the
// same way. Transient moves the knobs on hits as Animation's Reactive mode
// does; LFO moves them over time.
export function FxModulationPanel({
  device,
  modulation,
  collapsed,
  bypassed,
  onToggleCollapsed,
  onSetModulation,
}: FxModulationPanelProps) {
  const style = { "--fx-accent": device.accent } as CSSProperties;
  const label = `${device.name} modulation`;
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
          <span>Modulation</span>
        </button>
      </section>
    );
  }

  const defaults = createDefaultModulation(device.effectName);
  const available = getModulatableParameters(device.effectName);
  const set = (next: EffectModulation, mode: FxEditMode = "commit") =>
    onSetModulation?.(device, next, mode);
  const { transient, lfo } = modulation;
  const setTransient = (
    patch: Partial<EffectModulation["transient"]>,
    mode: FxEditMode = "commit",
  ) => set({ ...modulation, transient: { ...transient, ...patch } }, mode);
  const setLfo = (
    patch: Partial<EffectModulation["lfo"]>,
    mode: FxEditMode = "commit",
  ) => set({ ...modulation, lfo: { ...lfo, ...patch } }, mode);

  return (
    <section aria-label={label} className={className} style={style}>
      <header className="fx-animation-panel__title">
        <span className="fx-animation-panel__name">Modulation</span>
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
        <FxAnimationSegmented
          label="Mode"
          onChange={(mode) => set({ ...modulation, mode })}
          optionLabel={(mode) => MODULATION_MODE_LABELS[mode]}
          options={MODULATION_MODES}
          value={modulation.mode}
        />
        {modulation.mode === "transient" ? (
          <>
            <FxAnimationSegmented
              label="Timing"
              onChange={(timing) => setTransient({ timing })}
              options={ANIMATION_TIMINGS}
              value={transient.timing}
            />
            <div className="fx-animation-panel__knob">
              <Knob
                accent={device.accent}
                defaultValue={defaults?.transient.reactivity ?? 0.5}
                format={formatReactivity}
                label="Reactivity"
                max={1}
                min={0}
                onChange={(reactivity) =>
                  setTransient({ reactivity }, "transient")
                }
                onCommit={(reactivity) => setTransient({ reactivity })}
                step={REACTIVITY_STEP}
                value={transient.reactivity}
              />
            </div>
            <FxAnimationSelect
              label="Motion"
              onChange={(motion) => setTransient({ motion })}
              options={REACTIVE_MOTIONS}
              value={transient.motion}
            />
            <FxAnimatedParametersControl
              available={available}
              device={device}
              onChange={(parameters) => setTransient({ parameters })}
              selected={transient.parameters}
            />
          </>
        ) : (
          <>
            <FxAnimationSelect
              label="Shape"
              onChange={(shape) => setLfo({ shape })}
              options={LFO_SHAPES}
              value={lfo.shape}
            />
            <FxAnimationSegmented
              label="Sync"
              onChange={(sync) => setLfo({ sync: sync === "On" })}
              options={SYNC_OPTIONS}
              value={lfo.sync ? "On" : "Off"}
            />
            {lfo.sync ? (
              <FxAnimationSelect
                label="Rate"
                onChange={(note) => setLfo({ note })}
                options={LFO_NOTE_OPTIONS}
                value={lfo.note}
              />
            ) : (
              <div className="fx-animation-panel__knob">
                <Knob
                  accent={device.accent}
                  defaultValue={defaults?.lfo.rate ?? 1}
                  format={formatRate}
                  label="Rate"
                  max={LFO_RATE_MAX}
                  min={LFO_RATE_MIN}
                  onChange={(rate) => setLfo({ rate }, "transient")}
                  onCommit={(rate) => setLfo({ rate })}
                  step={0.01}
                  taper="log"
                  value={lfo.rate}
                />
              </div>
            )}
            <div className="fx-animation-panel__knob">
              <Knob
                accent={device.accent}
                defaultValue={defaults?.lfo.depth ?? 0.5}
                format={formatPercent}
                label="Depth"
                max={1}
                min={0}
                onChange={(depth) => setLfo({ depth }, "transient")}
                onCommit={(depth) => setLfo({ depth })}
                step={0.01}
                value={lfo.depth}
              />
            </div>
            <div className="fx-animation-panel__knob">
              <Knob
                accent={device.accent}
                defaultValue={0}
                format={formatDegrees}
                label="Phase"
                max={LFO_PHASE_MAX}
                min={0}
                onChange={(phase) => setLfo({ phase }, "transient")}
                onCommit={(phase) => setLfo({ phase })}
                step={1}
                value={lfo.phase}
              />
            </div>
            <FxAnimatedParametersControl
              available={available}
              device={device}
              onChange={(parameters) => setLfo({ parameters })}
              selected={lfo.parameters}
            />
          </>
        )}
      </div>
    </section>
  );
}
