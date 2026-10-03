import { ChevronLeftIcon } from "@heroicons/react/24/solid";
import type { CSSProperties } from "react";
import {
  ANIMATION_TIMINGS,
  REACTIVE_MOTIONS,
  REACTIVITY_STEP,
} from "../../fx-animation-defaults";
import {
  createDefaultModulation,
  type EffectModulation,
  getModulatableParameters,
  MODULATION_MODE_LABELS,
  MODULATION_MODES,
} from "../../fx-modulation-defaults";
import type { FxDevice } from "../../fx-stack";
import { Knob } from "../ui/Knob";
import {
  FxAnimatedParametersControl,
  FxAnimationSegmented,
  FxAnimationSelect,
  FxLfoControls,
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

// The Modulation section attached to an audio device's right edge while its
// Modulation toggle is on: the audio side's Animation section, built the
// same way. Transient moves the knobs on hits as Animation's Reactive mode
// does; LFO moves them over time with Animation's LFO controls.
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
          <FxLfoControls
            available={available}
            defaults={defaults?.lfo}
            device={device}
            lfo={lfo}
            onChange={setLfo}
          />
        )}
      </div>
    </section>
  );
}
