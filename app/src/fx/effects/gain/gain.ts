// The Gain effect's math: its dB range, the readout, and the linear
// amplitude a chain of Gains gives a clip. A clip makes sound only through
// Gain, so a chain without an enabled one is silent.

export const GAIN_EFFECT_NAME = "Gain";
export const GAIN_KEY = "Gain";
export const MUTE_KEY = "Mute";

// The fader's range in dB. Its bottom is mute, not -68 dB.
export const GAIN_MIN_DB = -68;
export const GAIN_MAX_DB = 10;
export const GAIN_DEFAULT_DB = 0;

const MINUS = "−";

export function isGainEffectName(effectName: string) {
  return effectName.trim().toLowerCase() === GAIN_EFFECT_NAME.toLowerCase();
}

// "Mute" at the bottom of the range, else the level such as "−6.0 dB" or
// "+3.5 dB".
export function formatGainDb(db: number) {
  if (!(db > GAIN_MIN_DB)) {
    return "Mute";
  }
  const rounded = Math.round(db * 10) / 10;
  const sign = rounded > 0 ? "+" : rounded < 0 ? MINUS : "";
  return `${sign}${Math.abs(rounded).toFixed(1)} dB`;
}

export function formatMute(value: number) {
  return value >= 0.5 ? "On" : "Off";
}

// The linear amplitude of one Gain: 0 when muted or at the bottom of the
// range, else 10^(dB/20).
export function gainToAmplitude(db: number, mute = false) {
  if (mute || !(db > GAIN_MIN_DB)) {
    return 0;
  }
  return 10 ** (Math.min(db, GAIN_MAX_DB) / 20);
}

type GainParameter = { key: string; value: string; numericValue?: number };

type GainChainEffect = {
  effectName: string;
  enabled?: boolean;
  parameters: readonly GainParameter[];
};

function readNumber(
  parameters: readonly GainParameter[],
  key: string,
  fallback: number,
) {
  const stored = parameters.find((parameter) => parameter.key === key);
  const value =
    stored?.numericValue ??
    (stored ? Number.parseFloat(stored.value) : Number.NaN);
  return Number.isFinite(value) ? value : fallback;
}

// The amplitude of one Gain effect from its stored parameters.
export function readGainAmplitude(effect: GainChainEffect) {
  return gainToAmplitude(
    readNumber(effect.parameters, GAIN_KEY, GAIN_DEFAULT_DB),
    readNumber(effect.parameters, MUTE_KEY, 0) >= 0.5,
  );
}

// The amplitude of a clip's chain, such as its own stack and its track's:
// the enabled Gains multiply, so their dB add. Bypassed Gains are skipped,
// and a chain with no enabled Gain is silent.
export function gainChainAmplitude(effects: readonly GainChainEffect[]) {
  let amplitude = 0;
  let found = false;
  for (const effect of effects) {
    if (effect.enabled === false || !isGainEffectName(effect.effectName)) {
      continue;
    }
    amplitude = (found ? amplitude : 1) * readGainAmplitude(effect);
    found = true;
  }
  return amplitude;
}

// The Global stack's master gain: its enabled Gains multiply, and without
// one the mix passes at unity.
export function masterGainAmplitude(effects: readonly GainChainEffect[]) {
  return effects.some(
    (effect) => effect.enabled !== false && isGainEffectName(effect.effectName),
  )
    ? gainChainAmplitude(effects)
    : 1;
}
