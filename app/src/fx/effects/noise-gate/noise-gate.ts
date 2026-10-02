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

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.detectorPole = Math.exp(-1 / (DETECTOR_SECONDS * sampleRate));
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
      const levelDb = 10 * Math.log10(Math.max(this.power, POWER_FLOOR));

      const threshold = block.threshold[index];
      if (levelDb >= threshold) {
        this.open = true;
        this.belowFrames = 0;
      } else if (this.open) {
        if (levelDb >= threshold - HYSTERESIS_DB) {
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
      const gain =
        this.openness >= 1
          ? 1
          : dbToAmplitude((1 - this.openness) * block.range[index]);
      for (let channel = 0; channel < output.length; channel++) {
        output[channel][index] = input[channel][index] * gain;
      }
    }
  }
}
