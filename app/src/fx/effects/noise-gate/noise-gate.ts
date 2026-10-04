// The Noise Gate's DSP: an RMS detector across all channels opens the gate
// when the level reaches Threshold and lets it close once the level has
// stayed 3 dB below it (the hysteresis) for Hold. Opening and closing ramp
// the gate's gain over Attack and Release, linearly in dB, between unity
// and Range. Every channel gets the same gain, so the stereo image holds.

export const NOISE_GATE_EFFECT_NAME = "Noise Gate";

export const THRESHOLD_KEY = "Threshold";
export const ATTACK_KEY = "Attack";
export const HOLD_KEY = "Hold";
export const RELEASE_KEY = "Release";
export const RANGE_KEY = "Range";

export const NOISE_GATE_RANGES = {
  // dBFS.
  [THRESHOLD_KEY]: { min: -80, max: 0, defaultValue: -50 },
  // Milliseconds.
  [ATTACK_KEY]: { min: 0.1, max: 50, defaultValue: 1 },
  [HOLD_KEY]: { min: 0, max: 500, defaultValue: 20 },
  [RELEASE_KEY]: { min: 5, max: 1000, defaultValue: 100 },
  // dB.
  [RANGE_KEY]: { min: -80, max: 0, defaultValue: -80 },
} as const;

export type NoiseGateNumberKey = keyof typeof NOISE_GATE_RANGES;

// Once open, the gate stays open until the level falls this far below
// Threshold, so a signal hovering at Threshold doesn't chatter.
export const HYSTERESIS_DB = 3;

// The detector averages the signal's power over about this long: smooth
// enough that a low tone's own cycles stay within the hysteresis, quick
// enough to catch a hit's onset within a few milliseconds.
export const DETECTOR_SECONDS = 0.01;

// The detector's floor, about −140 dBFS, so silence has a finite level.
const POWER_FLOOR = 1e-14;

const MINUS = "−";

// "−50.0 dB", "0.0 dB".
export function formatDb(db: number) {
  const rounded = Math.round(db * 10) / 10;
  const sign = rounded < 0 ? MINUS : "";
  return `${sign}${Math.abs(rounded).toFixed(1)} dB`;
}

// "0.10 ms", "1.0 ms", "20 ms".
export function formatMilliseconds(ms: number) {
  if (ms < 1) {
    return `${ms.toFixed(2)} ms`;
  }
  return ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`;
}

export function dbToAmplitude(db: number) {
  return 10 ** (db / 20);
}

export type NoiseGateBlock = {
  frames: number;
  // Each number parameter's value at every frame.
  threshold: Float32Array;
  attack: Float32Array;
  hold: Float32Array;
  release: Float32Array;
  range: Float32Array;
};

// Power within this ratio of a threshold's is too close to call without
// the level's log; beyond it, comparing powers decides exactly as
// comparing dB would.
const POWER_MARGIN = 1e-6;

// A dB threshold as the powers just above and below it, so a level can be
// checked against it without a log per frame.
class PowerThreshold {
  db = Number.NaN;
  above = Number.NaN;
  below = Number.NaN;

  set(db: number) {
    this.db = db;
    const power = 10 ** (db / 10);
    this.above = power * (1 + POWER_MARGIN);
    this.below = power * (1 - POWER_MARGIN);
  }

  reset() {
    this.db = Number.NaN;
    this.above = Number.NaN;
    this.below = Number.NaN;
  }
}

export class NoiseGateDsp {
  readonly sampleRate: number;
  private readonly detectorPole: number;
  // The detector's mean power.
  private power = POWER_FLOOR;
  private open = false;
  // Frames the level has stayed below the close threshold since it last
  // reached it.
  private belowFrames = 0;
  // 0 closed (gain at Range) to 1 open (unity), ramped over Attack and
  // Release.
  private openness = 0;
  // Threshold and the close threshold as powers, set once Threshold holds
  // for a second frame; while it ramps every frame takes the log instead.
  private lastThreshold = Number.NaN;
  private readonly openAt = new PowerThreshold();
  private readonly closeAt = new PowerThreshold();
  // The last gain below unity and its exponent, since a closed gate's
  // repeats.
  private gainDb = Number.NaN;
  private gain = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.detectorPole = Math.exp(-1 / (DETECTOR_SECONDS * sampleRate));
  }

  // Back to its constructed state.
  reset() {
    this.power = POWER_FLOOR;
    this.open = false;
    this.belowFrames = 0;
    this.openness = 0;
    this.lastThreshold = Number.NaN;
    this.openAt.reset();
    this.closeAt.reset();
    this.gainDb = Number.NaN;
    this.gain = 0;
  }

  process(
    input: readonly Float32Array[],
    output: Float32Array[],
    block: NoiseGateBlock,
  ) {
    const framesPerMs = this.sampleRate / 1000;
    for (let index = 0; index < block.frames; index++) {
      let square = 0;
      for (let channel = 0; channel < input.length; channel++) {
        const sample = input[channel][index];
        square = Math.max(square, sample * sample);
      }
      this.power = square + this.detectorPole * (this.power - square);
      const power = Math.max(this.power, POWER_FLOOR);

      const threshold = block.threshold[index];
      if (threshold === this.lastThreshold && this.openAt.db !== threshold) {
        this.openAt.set(threshold);
        this.closeAt.set(threshold - HYSTERESIS_DB);
      }
      this.lastThreshold = threshold;
      let levelDb = Number.NaN;
      let reaches: boolean;
      if (this.openAt.db === threshold && power >= this.openAt.above) {
        reaches = true;
      } else if (this.openAt.db === threshold && power <= this.openAt.below) {
        reaches = false;
      } else {
        levelDb = 10 * Math.log10(power);
        reaches = levelDb >= threshold;
      }
      if (reaches) {
        this.open = true;
        this.belowFrames = 0;
      } else if (this.open) {
        if (this.withinHysteresis(power, levelDb, threshold)) {
          this.belowFrames = 0;
        } else if (++this.belowFrames > block.hold[index] * framesPerMs) {
          this.open = false;
        }
      }

      if (this.open) {
        this.openness = Math.min(
          1,
          this.openness + 1 / (block.attack[index] * framesPerMs),
        );
      } else {
        this.openness = Math.max(
          0,
          this.openness - 1 / (block.release[index] * framesPerMs),
        );
      }
      let gain = 1;
      if (this.openness < 1) {
        const gainDb = (1 - this.openness) * block.range[index];
        if (gainDb !== this.gainDb) {
          this.gainDb = gainDb;
          this.gain = dbToAmplitude(gainDb);
        }
        gain = this.gain;
      }
      for (let channel = 0; channel < output.length; channel++) {
        output[channel][index] = input[channel][index] * gain;
      }
    }
  }

  // Whether an open gate's level is still within HYSTERESIS_DB of
  // `threshold`. `levelDb` is NaN when the frame skipped its log.
  private withinHysteresis(power: number, levelDb: number, threshold: number) {
    const closeDb = threshold - HYSTERESIS_DB;
    if (this.openAt.db === threshold) {
      if (power >= this.closeAt.above) {
        return true;
      }
      if (power <= this.closeAt.below) {
        return false;
      }
    }
    const db = Number.isNaN(levelDb) ? 10 * Math.log10(power) : levelDb;
    return db >= closeDb;
  }
}
