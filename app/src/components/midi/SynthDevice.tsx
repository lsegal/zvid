import { ChevronLeftIcon, MusicalNoteIcon } from "@heroicons/react/24/solid";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import type { FxNumberTaper } from "../../fx/types.ts";
import {
  DEFAULT_SYNTH_PARAMS,
  SYNTH_PARAM_RANGES,
  SYNTH_WAVES,
  type SynthParams,
  type SynthWave,
} from "../../midi-clip.ts";
import { SYNTH_PARAM_LABELS } from "../../midi-editing.ts";
import type { SynthTrackModel } from "../../midi-panel-model.ts";
import type { FxEditMode } from "../fx/types";
import { Knob } from "../ui/Knob";
import "../fx/fx-chain.css";
import "./midi-devices.css";

type NumericKey = Exclude<keyof SynthParams, "wave">;

export type SetSynthParam = <Key extends keyof SynthParams>(
  trackId: string,
  key: Key,
  value: SynthParams[Key],
  mode?: FxEditMode,
) => void;

type SynthDeviceProps = {
  model: SynthTrackModel;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSetParam: SetSynthParam;
};

const ACCENT = "#9fd4ff";

const WAVE_LABELS: Record<SynthWave, string> = {
  sawtooth: "Saw",
  square: "Square",
  triangle: "Tri",
  sine: "Sine",
};

function formatSeconds(seconds: number) {
  return seconds < 1
    ? `${Math.round(seconds * 1000)} ms`
    : `${seconds.toFixed(2)} s`;
}

function formatHertz(hertz: number) {
  return hertz < 1000
    ? `${Math.round(hertz)} Hz`
    : `${(hertz / 1000).toFixed(1)} kHz`;
}

type KnobSpec = {
  key: NumericKey;
  min: number;
  max: number;
  step?: number;
  taper?: FxNumberTaper;
  format: (value: number) => string;
};

// Envelope times and the filter move by ratio; their knobs start just above
// 0, where a log taper must.
const TIME = { min: 0.001, taper: "log", format: formatSeconds } as const;

// The device's rows of knobs, as in an FX device: the oscillator's tuning,
// the lowpass filter, and the ADSR envelope.
const KNOB_ROWS: Array<{ label: string; knobs: KnobSpec[] }> = [
  {
    label: "Osc",
    knobs: [
      {
        key: "octave",
        ...SYNTH_PARAM_RANGES.octave,
        step: 1,
        format: (value) => (value > 0 ? `+${value}` : `${value}`),
      },
      {
        key: "detune",
        ...SYNTH_PARAM_RANGES.detune,
        step: 1,
        format: (value) => `${Math.round(value)} ¢`,
      },
    ],
  },
  {
    label: "Filter",
    knobs: [
      {
        key: "cutoff",
        ...SYNTH_PARAM_RANGES.cutoff,
        taper: "log",
        format: formatHertz,
      },
      {
        key: "resonance",
        min: 0.1,
        max: SYNTH_PARAM_RANGES.resonance.max,
        taper: "log",
        format: (value) => value.toFixed(1),
      },
    ],
  },
  {
    label: "Env",
    knobs: [
      { key: "attack", ...TIME, max: SYNTH_PARAM_RANGES.attack.max },
      { key: "decay", ...TIME, max: SYNTH_PARAM_RANGES.decay.max },
      {
        key: "sustain",
        ...SYNTH_PARAM_RANGES.sustain,
        step: 0.01,
        format: (value) => `${Math.round(value * 100)}%`,
      },
      { key: "release", ...TIME, max: SYNTH_PARAM_RANGES.release.max },
    ],
  },
];

// A source track's Synth device, the instrument its MIDI clips play
// through: the oscillator's wave, octave and detune, the lowpass filter's
// cutoff and resonance, and the ADSR envelope. It leads the Track section
// and folds to a strip like an effect device; its edits are undoable like a
// device's parameters.
export function SynthDevice({
  model,
  collapsed,
  onToggleCollapsed,
  onSetParam,
}: SynthDeviceProps) {
  const { trackId, trackName, synth } = model;
  const label = `${trackName} synth`;
  const style = { "--fx-accent": ACCENT } as CSSProperties;
  const icon = (
    <span className="synth-device__icon">
      <MusicalNoteIcon aria-hidden="true" />
    </span>
  );

  if (collapsed) {
    return (
      <section
        aria-label={label}
        className="fx-device-panel fx-device-panel--collapsed synth-device"
        style={style}
      >
        {icon}
        <button
          aria-expanded={false}
          aria-label="Expand Synth"
          className="fx-device-panel__strip"
          onClick={onToggleCollapsed}
          title="Expand Synth"
          type="button"
        >
          <span>Synth</span>
        </button>
      </section>
    );
  }

  function handleTitleDoubleClick(event: ReactMouseEvent<HTMLElement>) {
    if (!(event.target as HTMLElement).closest("button")) {
      onToggleCollapsed();
    }
  }

  return (
    <section
      aria-label={label}
      className="fx-device-panel synth-device"
      style={style}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: double-click is a pointer shortcut; the collapse button is its keyboard equivalent */}
      <header
        className="fx-device-panel__title"
        onDoubleClick={handleTitleDoubleClick}
      >
        {icon}
        <span className="fx-device-panel__name">Synth</span>
        <button
          aria-expanded
          aria-label="Collapse Synth"
          className="fx-device-panel__collapse"
          onClick={onToggleCollapsed}
          title="Collapse Synth"
          type="button"
        >
          <ChevronLeftIcon aria-hidden="true" />
        </button>
      </header>
      <div className="fx-device-panel__body synth-device__body">
        <fieldset className="fx-segmented">
          <legend>{SYNTH_PARAM_LABELS.wave}</legend>
          <div className="fx-segmented__options">
            {SYNTH_WAVES.map((wave) => (
              <button
                aria-pressed={synth.wave === wave}
                key={wave}
                onClick={() => onSetParam(trackId, "wave", wave)}
                type="button"
              >
                {WAVE_LABELS[wave]}
              </button>
            ))}
          </div>
        </fieldset>
        {KNOB_ROWS.map((row) => (
          <fieldset className="fx-device-panel__knob-row" key={row.label}>
            <legend className="fx-device-panel__row-label">{row.label}</legend>
            {row.knobs.map((knob) => (
              <Knob
                accent={ACCENT}
                bipolar={knob.min < 0 && knob.max > 0}
                defaultValue={DEFAULT_SYNTH_PARAMS[knob.key]}
                format={knob.format}
                key={knob.key}
                label={SYNTH_PARAM_LABELS[knob.key]}
                max={knob.max}
                min={knob.min}
                onChange={(value) =>
                  onSetParam(trackId, knob.key, value, "transient")
                }
                onCommit={(value) =>
                  onSetParam(trackId, knob.key, value, "commit")
                }
                step={knob.step}
                taper={knob.taper}
                value={synth[knob.key]}
              />
            ))}
          </fieldset>
        ))}
      </div>
    </section>
  );
}
