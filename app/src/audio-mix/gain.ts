// Gain is the only way a clip makes sound (#700): a clip's amplitude is the
// product of the enabled Gain devices in its chain, and a chain without one
// is silent. This module reads Gain devices off session effects; the audio
// mix (see resolve.ts) multiplies them along each clip's chain.

export const GAIN_EFFECT_NAME = "Gain";

// The bottom of the Gain range, which plays as silence rather than −68 dB.
export const MIN_GAIN_DB = -68;
export const MAX_GAIN_DB = 10;

type GainParameter = { key: string; value: string; numericValue?: number };

export type GainEffect = {
  effectName: string;
  enabled?: boolean;
  parameters: GainParameter[];
};

export function isGainEffectName(effectName: string) {
  return effectName.trim().toLowerCase() === GAIN_EFFECT_NAME.toLowerCase();
}

// Effects the audio engine applies. Video passes ignore these, and the
// audio engine ignores every other effect.
export function isAudioEffectName(effectName: string) {
  return isGainEffectName(effectName);
}

// The linear amplitude of `db`: 0 at or below the bottom of the range.
export function dbToAmplitude(db: number) {
  if (!Number.isFinite(db) || db <= MIN_GAIN_DB) {
    return 0;
  }
  return 10 ** (Math.min(db, MAX_GAIN_DB) / 20);
}

function parameterNumber(parameter: GainParameter) {
  if (Number.isFinite(parameter.numericValue)) {
    return parameter.numericValue as number;
  }
  const parsed = Number.parseFloat(parameter.value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isOn(parameter: GainParameter) {
  const value = parameter.value.trim().toLowerCase();
  if (value === "true" || value === "on") {
    return true;
  }
  return (parameterNumber(parameter) ?? 0) > 0;
}

function isMuteKey(key: string) {
  return key.toLowerCase().includes("mute");
}

function isGainKey(key: string) {
  const lower = key.toLowerCase();
  return !isMuteKey(key) && (lower.includes("gain") || lower.includes("db"));
}

// One Gain device's amplitude: `mute || dB <= -68 ? 0 : 10^(dB/20)`. A
// missing Gain parameter reads as its 0 dB default.
export function gainAmplitude(effect: GainEffect) {
  const mute = effect.parameters.find((parameter) => isMuteKey(parameter.key));
  if (mute && isOn(mute)) {
    return 0;
  }
  const gain = effect.parameters.find((parameter) => isGainKey(parameter.key));
  return dbToAmplitude(gain ? (parameterNumber(gain) ?? 0) : 0);
}

// The amplitude of a chain: the product of its enabled Gain devices, or
// `fallback` when it has none (0 for a clip's chain, which is silent
// without a Gain; 1 for the master).
export function chainAmplitude(effects: readonly GainEffect[], fallback = 0) {
  let amplitude: number | undefined;
  for (const effect of effects) {
    if (effect.enabled === false || !isGainEffectName(effect.effectName)) {
      continue;
    }
    amplitude = (amplitude ?? 1) * gainAmplitude(effect);
  }
  return amplitude ?? fallback;
}
