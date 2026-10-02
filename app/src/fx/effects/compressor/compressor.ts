// The Compressor effect: a feed-forward compressor with a log-domain gain
// computer. Each frame's peak across the channels sets one gain for all of
// them, so the stereo image holds. The gain computer turns that level in dB
// into a gain reduction (Threshold, Ratio and a quadratic soft Knee), which
// a smooth decoupled peak detector follows: it holds peaks and falls with
// the Release time constant, then a one-pole filter rises with the Attack
// time constant. Makeup is added to the compressed signal, and Mix blends
// it with the dry input for parallel compression.

export const COMPRESSOR_EFFECT_NAME = "Compressor";

export const THRESHOLD_KEY = "Threshold";
export const RATIO_KEY = "Ratio";
export const ATTACK_KEY = "Attack";
export const RELEASE_KEY = "Release";
export const KNEE_KEY = "Knee";
export const MAKEUP_KEY = "Makeup";
export const MIX_KEY = "Mix";

export type CompressorParameterKey =
  | typeof THRESHOLD_KEY
  | typeof RATIO_KEY
  | typeof ATTACK_KEY
  | typeof RELEASE_KEY
  | typeof KNEE_KEY
  | typeof MAKEUP_KEY
  | typeof MIX_KEY;

type Range = { min: number; max: number; defaultValue: number };

// dB, ratio (n:1), milliseconds, and Mix as a fraction.
export const COMPRESSOR_RANGES: Record<CompressorParameterKey, Range> = {
  [THRESHOLD_KEY]: { min: -60, max: 0, defaultValue: -18 },
  [RATIO_KEY]: { min: 1, max: 20, defaultValue: 4 },
  [ATTACK_KEY]: { min: 0.1, max: 100, defaultValue: 10 },
  [RELEASE_KEY]: { min: 10, max: 1000, defaultValue: 100 },
  [KNEE_KEY]: { min: 0, max: 30, defaultValue: 6 },
  [MAKEUP_KEY]: { min: 0, max: 24, defaultValue: 0 },
  [MIX_KEY]: { min: 0, max: 1, defaultValue: 1 },
};

// A silent frame's level, so its log stays finite.
const SILENCE_DB = -200;

const MINUS = "−";

// "−18.0 dB", "0.0 dB".
export function formatDb(db: number) {
  const rounded = Math.round(db * 10) / 10;
  return `${rounded < 0 ? MINUS : ""}${Math.abs(rounded).toFixed(1)} dB`;
}

// "+6.0 dB" for makeup gain.
export function formatMakeupDb(db: number) {
  const rounded = Math.round(db * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${formatDb(rounded)}`;
}

// "4.0:1", "20:1".
export function formatRatio(ratio: number) {
  return `${ratio < 10 ? ratio.toFixed(1) : Math.round(ratio)}:1`;
}

// "0.10 ms", "10.0 ms", "250 ms".
export function formatMs(ms: number) {
  if (ms < 1) {
    return `${ms.toFixed(2)} ms`;
  }
  return `${ms < 100 ? ms.toFixed(1) : Math.round(ms)} ms`;
}

// The gain computer: the output level in dB for an input level in dB.
// Below the knee it is unchanged, above it the excess over Threshold is
// divided by Ratio, and across the knee, Knee dB wide and centred on
// Threshold, a quadratic joins the two.
export function compressedLevelDb(
  levelDb: number,
  thresholdDb: number,
  ratio: number,
  kneeDb: number,
) {
  const over = levelDb - thresholdDb;
  if (2 * over <= -kneeDb) {
    return levelDb;
  }
  const slope = 1 / Math.max(ratio, 1) - 1;
  if (2 * over < kneeDb) {
    const into = over + kneeDb / 2;
    return levelDb + (slope * into * into) / (2 * kneeDb);
  }
  return levelDb + slope * over;
}

// A one-pole filter's coefficient for a time constant in milliseconds: the
// filter covers 1 − 1/e of a step in that time.
export function smoothingCoefficient(ms: number, sampleRate: number) {
  return Math.exp(-1000 / (Math.max(ms, 1e-3) * sampleRate));
}

export type CompressorBlock = {
  frames: number;
  sampleRate: number;
  // Each parameter's value at every frame.
  thresholdDb: Float32Array;
  ratio: Float32Array;
  attackMs: Float32Array;
  releaseMs: Float32Array;
  kneeDb: Float32Array;
  makeupDb: Float32Array;
  mix: Float32Array;
};

export class CompressorDsp {
  // The gain reduction in dB, as held by the release stage and then as
  // smoothed by the attack stage.
  private held = 0;
  private reduction = 0;
  // The time constants the coefficients were last computed for.
  private attackMs = Number.NaN;
  private releaseMs = Number.NaN;
  private attack = 0;
  private release = 0;

  process(
    input: readonly Float32Array[],
    output: Float32Array[],
    block: CompressorBlock,
  ) {
    const { frames, sampleRate } = block;
    const channels = output.length;
    let held = this.held;
    let reduction = this.reduction;
    for (let index = 0; index < frames; index++) {
      const attackMs = block.attackMs[index];
      if (attackMs !== this.attackMs) {
        this.attackMs = attackMs;
        this.attack = smoothingCoefficient(attackMs, sampleRate);
      }
      const releaseMs = block.releaseMs[index];
      if (releaseMs !== this.releaseMs) {
        this.releaseMs = releaseMs;
        this.release = smoothingCoefficient(releaseMs, sampleRate);
      }

      let peak = 0;
      for (let channel = 0; channel < channels; channel++) {
        peak = Math.max(peak, Math.abs(input[channel][index]));
      }
      const levelDb = peak > 0 ? 20 * Math.log10(peak) : SILENCE_DB;
      const target =
        levelDb -
        compressedLevelDb(
          levelDb,
          block.thresholdDb[index],
          block.ratio[index],
          block.kneeDb[index],
        );
      held = Math.max(target, this.release * held + (1 - this.release) * target);
      reduction = this.attack * reduction + (1 - this.attack) * held;

      const mix = block.mix[index];
      const wet = 10 ** ((block.makeupDb[index] - reduction) / 20) * mix;
      for (let channel = 0; channel < channels; channel++) {
        const dry = input[channel][index];
        output[channel][index] = dry * (1 - mix) + dry * wet;
      }
    }
    this.held = held;
    this.reduction = reduction;
  }
}
