// What a known MIDI device's controls move (midi-input/device-controls.ts): the
// selected effect's numeric parameters and the source tracks' Gain. Pure, so
// each edit works from the effects it's applied to.
import {
  GAIN_EFFECT_NAME,
  GAIN_KEY,
  isGainEffectName,
} from "./fx/effects/gain/gain.ts";
import { taperPosition, taperValue } from "./fx/taper.ts";
import {
  addEffect,
  type FxDevice,
  type FxDeviceParameter,
  mapSessionEffectsToDevices,
  type SessionEffect,
  setEffectParameter,
  sourceTrackEffectTrackId,
} from "./fx-stack.ts";
import type { DeviceControlMove } from "./midi-input/device-controls.ts";

/** Applies `move` to a 0..1 position, for a control with nothing to scale. */
export function movePosition(position: number, move: DeviceControlMove) {
  return Math.min(1, Math.max(0, move.to ?? position + move.by));
}

function deviceOf(effect: SessionEffect): FxDevice | undefined {
  return mapSessionEffectsToDevices(
    [effect],
    effect.trackId,
    undefined,
    undefined,
    undefined,
    effect.trackId,
  )[0];
}

/** The parameters of `effect` that knobs 1 to N drive, in panel order. */
export function knobParameters(effect: SessionEffect): FxDeviceParameter[] {
  return (deviceOf(effect)?.parameters ?? []).filter(
    (parameter) =>
      parameter.kind === "number" && parameter.control !== "toggle",
  );
}

function movedValue(parameter: FxDeviceParameter, move: DeviceControlMove) {
  const { min, max, taper, step, numericValue = min } = parameter;
  const position = taperPosition(numericValue, min, max, taper);
  const value = taperValue(movePosition(position, move), min, max, taper);
  return step ? Number((Math.round(value / step) * step).toFixed(6)) : value;
}

/** `effects` with the selected effect's parameter `index` moved. */
export function moveEffectKnob(
  effects: SessionEffect[],
  effectId: string | null | undefined,
  index: number,
  move: DeviceControlMove,
) {
  const effect = effects.find((candidate) => candidate.id === effectId);
  const parameter = effect && knobParameters(effect)[index];
  return effect && parameter
    ? setEffectParameter(
        effects,
        effect.id,
        parameter.key,
        movedValue(parameter, move),
      )
    : effects;
}

/**
 * `effects` with `sourceTrackId`'s volume moved: the first Gain of its own
 * stack, which it gets if it has none, as a fader there is nothing without one.
 */
export function moveTrackVolume(
  effects: SessionEffect[],
  sourceTrackId: string,
  move: DeviceControlMove,
) {
  const trackId = sourceTrackEffectTrackId(sourceTrackId);
  const findGain = (current: SessionEffect[]) =>
    current.find(
      (effect) =>
        effect.trackId === trackId && isGainEffectName(effect.effectName),
    );
  const withGain = findGain(effects)
    ? effects
    : addEffect(effects, trackId, GAIN_EFFECT_NAME);
  const gain = findGain(withGain);
  const parameter = gain && deviceOf(gain)?.parameters.find(
    (candidate) => candidate.key === GAIN_KEY,
  );
  return gain && parameter
    ? setEffectParameter(
        withGain,
        gain.id,
        GAIN_KEY,
        movedValue(parameter, move),
      )
    : effects;
}
