// A MIDI effect's Modulation: Synth, Granular and Arpeggiator knobs move as an
// audio effect's do, on the same LFO and the same swings (see modulation.ts).
// An audio effect's chain moves its knobs as it runs, but a MIDI clip is
// rendered ahead of time, so here they are worked out at the seconds the notes
// and voices need them, still on session time so a synced LFO lines up with the
// session's bars. Reactive has no audio to listen to before the clip has
// rendered: its hits are the notes reaching the effect, as loud as their
// velocity.
import type { ReactiveAnimation } from "../fx-animation-defaults.ts";
import {
  REACTIVE_FRAME_RATE,
  type ReactiveOnset,
  reactiveSwingAt,
} from "../fx-animation-impulse.ts";
import type { MidiNote } from "../midi-clip.ts";
import {
  type AudioStageModulation,
  lfoSwing,
  type ModulatedParameter,
  modulatedValue,
  transientSwing,
} from "./modulation.ts";
import type { AudioTempo, AudioTimeSignature } from "./processor.ts";

// How often a knob moving through a sounding voice is sampled, in seconds.
const CONTROL_SECONDS = 1 / 120;

/** A MIDI effect's Modulation while on, seeded by the effect's id. */
export type MidiModulation = AudioStageModulation & { seed: string };

/** Where a MIDI clip's content starts on the session's clock, once modulated. */
export type MidiModulationClock = {
  // The session second of the clip's content start.
  offsetSeconds: number;
  signature: AudioTimeSignature;
};

/**
 * Where a modulated knob is: `value` at `seconds`, on whichever clock it was
 * made for, moving the value it is set to.
 */
export type MidiModulator = {
  moves: (key: string) => boolean;
  value: (key: string, base: number, seconds: number) => number;
};

/**
 * The hits `notes` give Reactive: their starts in session seconds, ascending,
 * with a chord's notes struck together as its loudest.
 */
export function noteOnsets(
  notes: readonly Pick<MidiNote, "start" | "velocity">[],
  bpm: number,
  offsetSeconds: number,
): ReactiveOnset[] {
  const secondsPerQuarter = 60 / bpm;
  const onsets = new Map<number, number>();
  for (const { start, velocity } of notes) {
    onsets.set(start, Math.max(onsets.get(start) ?? 0, velocity / 127));
  }
  return [...onsets]
    .sort(([left], [right]) => left - right)
    .map(([start, strength]) => ({
      time: start * secondsPerQuarter + offsetSeconds,
      strength,
    }));
}

/**
 * How `modulation` moves the knobs: the fraction of its travel `key` swings by
 * at session second `time`, after `onsets`.
 */
export function modulationSwing(
  modulation: MidiModulation,
  key: string,
  time: number,
  tempo: AudioTempo,
  onsets: readonly ReactiveOnset[],
) {
  return modulation.mode === "lfo"
    ? lfoSwing(modulation, modulation.seed, key, time, tempo)
    : transientSwing(modulation, modulation.seed, key, onsets, time);
}

/**
 * What Reactive `transient` settings make of `onsets` at session second `time`:
 * the level and hit moving the knobs, as a chain would report them for an audio
 * effect (see transient-monitor.ts), for the Modulation section to show.
 */
export function reactiveLevelAt(
  transient: Pick<ReactiveAnimation, "motion" | "reactivity" | "amplitude">,
  lengthFrames: number,
  onsets: readonly ReactiveOnset[],
  time: number,
) {
  const hit = reactiveSwingAt(
    transient,
    onsets,
    time,
    lengthFrames,
    REACTIVE_FRAME_RATE,
  );
  return { level: hit?.amount ?? 0, hit: hit?.seed ?? 0 };
}

/**
 * The modulator for `modulation` on a clock of its own: `sessionTime` places
 * the modulator's seconds on the session's and `onsets` gives the hits so far.
 */
export function createModulator(
  modulation: MidiModulation,
  tempo: (seconds: number) => AudioTempo,
  sessionTime: (seconds: number) => number,
  onsets: (seconds: number) => readonly ReactiveOnset[],
): MidiModulator {
  const parameters = new Map<string, ModulatedParameter>(
    modulation.parameters.map((parameter) => [parameter.key, parameter]),
  );
  return {
    moves: (key) => parameters.has(key),
    value(key, base, seconds) {
      const parameter = parameters.get(key);
      return parameter
        ? modulatedValue(
            base,
            modulationSwing(
              modulation,
              key,
              sessionTime(seconds),
              tempo(seconds),
              onsets(seconds),
            ),
            parameter,
          )
        : base;
    },
  };
}

/**
 * The modulator for a MIDI clip's `notes`, its seconds from the clip's content
 * start. Undefined without a modulation or a clock.
 */
export function clipModulator(
  modulation: MidiModulation | undefined,
  notes: readonly MidiNote[],
  bpm: number,
  clock: MidiModulationClock | undefined,
): MidiModulator | undefined {
  if (!modulation || !clock) {
    return undefined;
  }
  const tempo = { bpm, signature: clock.signature };
  const onsets =
    modulation.mode === "transient"
      ? noteOnsets(notes, bpm, clock.offsetSeconds)
      : [];
  return createModulator(
    modulation,
    () => tempo,
    (seconds) => seconds + clock.offsetSeconds,
    () => onsets,
  );
}

/**
 * `params` with the knobs named in `keys` where `modulator` has them at
 * `seconds`. Knobs nothing moves keep their values.
 */
export function modulatedParams<Params extends object>(
  params: Params,
  keys: { readonly [Field in keyof Params]?: string },
  modulator: MidiModulator,
  seconds: number,
): Params {
  const moved = { ...params };
  for (const field of Object.keys(keys) as (keyof Params & string)[]) {
    const key = keys[field];
    if (key !== undefined && modulator.moves(key)) {
      moved[field] = modulator.value(
        key,
        params[field] as number,
        seconds,
      ) as Params[keyof Params & string];
    }
  }
  return moved;
}

/**
 * The curve of a knob moving from `from` to `to`, sampled often enough to
 * follow it, its values through `value`.
 */
export function controlCurve(
  from: number,
  to: number,
  value: (seconds: number) => number,
) {
  const steps = Math.max(1, Math.ceil((to - from) / CONTROL_SECONDS));
  return Array.from({ length: steps + 1 }, (_, step) => {
    const seconds = from + ((to - from) * step) / steps;
    return { seconds, value: value(seconds) };
  });
}
