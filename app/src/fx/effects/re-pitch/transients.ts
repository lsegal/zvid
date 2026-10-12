// Re-Pitch's Transients algorithm: shifts pitch without changing timing by
// overlap-adding grains, each read from the recent input at the pitch ratio
// and centered on the moment it plays, latency frames late.
//
// Regular grains are Hann-windowed and start every half grain, so they sum
// to unity. Reading faster or slower than real time, a grain would smear an
// attack or play it twice, so the input is watched for onsets (its short-
// term power jumping well above its longer-term power), which the latency
// lets it see before they play. Each onset fades the grains then sounding
// out and starts a transient grain just before it: that grain rises in a
// millisecond, holds for half a grain and falls as a regular grain does, so
// the attack plays once, whole and in time, and the regular grains carry on
// from it without reading back over it. The Transients amount sets how
// readily an onset is heard and how fast the grains before it fade.
import { rePitchRate } from "./re-pitch.ts";

const GRAINS = 6;
const PENDING = 8;
// The transient grain starts this long before the onset was detected, and
// rises over the first millisecond of that.
const PRE_SECONDS = 0.002;
const ATTACK_SECONDS = 0.001;
// Short-term and long-term power, followed with these time constants.
const FAST_SECONDS = 0.002;
const SLOW_SECONDS = 0.06;
// An onset is short-term power this many times the long-term power: a
// sensitivity from least (Transients just above 0%) to most (100%).
const LEAST_SENSITIVE = 16;
const MOST_SENSITIVE = 2.5;
// Below this power (−60 dBFS) nothing is an onset.
const POWER_FLOOR = 1e-6;
// Regular grains starting after an onset read from at least this long after
// it, so they do not repeat its attack.
const GUARD_SECONDS = 0.005;

type Grain = {
  active: boolean;
  transient: boolean;
  // The input frame it reads next, fractional, and how far it moves a frame.
  position: number;
  rate: number;
  age: number;
  // Frames left of its fade out, of fadeLength; 0 while it is not fading.
  fade: number;
  fadeLength: number;
};

export class TransientShifter {
  readonly latency: number;
  private readonly grainLength: number;
  private readonly preFrames: number;
  private readonly attackFrames: number;
  private readonly guardFrames: number;
  private readonly fastCoefficient: number;
  private readonly slowCoefficient: number;
  private readonly history: Float32Array[];
  private readonly mask: number;
  private readonly grains: Grain[];
  // Output frames at which transient grains start, in order.
  private readonly pending: Float64Array;
  private pendingStart = 0;
  private pendingCount = 0;
  // The frame being processed, counted from the last reset.
  private time = 0;
  private nextGrain = 0;
  private fast = 0;
  private slow = 0;
  // The input frame the last transient grain started reading at, and the
  // earliest input frame of the next onset.
  private lastOnset = Number.NEGATIVE_INFINITY;
  private nextOnset = 0;

  constructor(sampleRate: number, channels: number, frameSize: number) {
    this.latency = frameSize;
    // Three-quarters of a frame, so even the transient grain reads only
    // input that has arrived when shifting up a little over an octave.
    this.grainLength = 2 * Math.round((frameSize * 0.75) / 2);
    this.preFrames = Math.round(PRE_SECONDS * sampleRate);
    this.attackFrames = Math.max(1, Math.round(ATTACK_SECONDS * sampleRate));
    this.guardFrames = Math.round(GUARD_SECONDS * sampleRate);
    this.fastCoefficient = Math.exp(-1 / (FAST_SECONDS * sampleRate));
    this.slowCoefficient = Math.exp(-1 / (SLOW_SECONDS * sampleRate));
    const size = 2 ** Math.ceil(Math.log2(frameSize * 4));
    this.mask = size - 1;
    this.history = Array.from(
      { length: channels },
      () => new Float32Array(size),
    );
    this.grains = Array.from({ length: GRAINS }, () => ({
      active: false,
      transient: false,
      position: 0,
      rate: 1,
      age: 0,
      fade: 0,
      fadeLength: 0,
    }));
    this.pending = new Float64Array(PENDING);
  }

  // Shifts `frames` frames of `input` into `output`, latency frames late,
  // by `semitones` plus `cents` at each frame. `transients` is the amount,
  // 0 to 1; at 0 no onset is looked for.
  process(
    input: readonly Float32Array[],
    output: Float32Array[],
    frames: number,
    semitones: Float32Array,
    cents: Float32Array,
    transients: number,
  ) {
    const half = this.grainLength / 2;
    const threshold =
      LEAST_SENSITIVE + (MOST_SENSITIVE - LEAST_SENSITIVE) * transients;
    // The grains sounding when an onset arrives fade over half a grain at
    // the least amount, down to the attack's length at the most.
    const fadeLength = Math.max(
      this.attackFrames,
      Math.round(half + (this.attackFrames - half) * transients),
    );
    for (let index = 0; index < frames; index++) {
      const time = this.time;
      const at = time & this.mask;
      let power = 0;
      for (let channel = 0; channel < this.history.length; channel++) {
        const sample = input[channel][index];
        this.history[channel][at] = sample;
        power += sample * sample;
      }
      if (transients > 0) {
        this.detectOnset(time, power, threshold);
      }
      const rate = rePitchRate(semitones[index], cents[index]);
      if (this.pendingCount && this.pending[this.pendingStart] <= time) {
        this.pendingStart = (this.pendingStart + 1) % PENDING;
        this.pendingCount--;
        for (const grain of this.grains) {
          if (grain.active && !grain.fade) {
            grain.fade = fadeLength;
            grain.fadeLength = fadeLength;
          }
        }
        this.lastOnset = time - this.latency;
        this.startGrain(true, this.lastOnset, rate);
        this.nextGrain = time + half;
      } else if (time >= this.nextGrain) {
        // Centered on the moment it plays, unless that would read back
        // over the last onset, and never past the input that has arrived.
        const centered = time + half - this.latency - rate * half;
        const newest = time + this.grainLength - 2 - rate * this.grainLength;
        const position = Math.min(
          newest,
          Math.max(centered, this.lastOnset + this.guardFrames),
        );
        this.startGrain(false, position, rate);
        this.nextGrain = time + half;
      }
      for (let channel = 0; channel < output.length; channel++) {
        output[channel][index] = 0;
      }
      // A grain still sounding before the next onset plays fades out
      // rather than read ahead into its attack.
      const onsetPosition = this.pendingCount
        ? this.pending[this.pendingStart] - this.latency
        : Number.POSITIVE_INFINITY;
      for (const grain of this.grains) {
        if (!grain.active) {
          continue;
        }
        if (grain.position + grain.rate >= onsetPosition && !grain.fade) {
          grain.fade = this.attackFrames;
          grain.fadeLength = this.attackFrames;
        }
        this.playGrain(grain, output, index);
      }
      this.time++;
    }
  }

  reset() {
    for (const line of this.history) {
      line.fill(0);
    }
    for (const grain of this.grains) {
      grain.active = false;
    }
    this.pendingStart = 0;
    this.pendingCount = 0;
    this.time = 0;
    this.nextGrain = 0;
    this.fast = 0;
    this.slow = 0;
    this.lastOnset = Number.NEGATIVE_INFINITY;
    this.nextOnset = 0;
  }

  private detectOnset(time: number, power: number, threshold: number) {
    this.fast = power + (this.fast - power) * this.fastCoefficient;
    const onset =
      time >= this.nextOnset &&
      this.fast > POWER_FLOOR &&
      this.fast > threshold * this.slow &&
      this.pendingCount < PENDING;
    this.slow = power + (this.slow - power) * this.slowCoefficient;
    if (!onset) {
      return;
    }
    const start = time - this.preFrames;
    this.pending[(this.pendingStart + this.pendingCount) % PENDING] =
      start + this.latency;
    this.pendingCount++;
    this.nextOnset = time + this.grainLength / 2;
  }

  private startGrain(transient: boolean, position: number, rate: number) {
    // A free grain, or when all are busy the one nearest its end.
    let grain = this.grains[0];
    for (const candidate of this.grains) {
      if (!candidate.active) {
        grain = candidate;
        break;
      }
      if (candidate.age > grain.age) {
        grain = candidate;
      }
    }
    grain.active = true;
    grain.transient = transient;
    grain.position = position;
    grain.rate = rate;
    grain.age = 0;
    grain.fade = 0;
    grain.fadeLength = 0;
  }

  private envelope(grain: Grain) {
    const { age } = grain;
    const { grainLength } = this;
    let gain: number;
    if (grain.transient && age < this.attackFrames) {
      gain = Math.sin((Math.PI / 2) * (age / this.attackFrames)) ** 2;
    } else if (grain.transient && age < grainLength / 2) {
      gain = 1;
    } else {
      gain = Math.sin((Math.PI * age) / grainLength) ** 2;
    }
    if (grain.fadeLength) {
      gain *= grain.fade / grain.fadeLength;
    }
    return gain;
  }

  private playGrain(grain: Grain, output: Float32Array[], index: number) {
    const gain = this.envelope(grain);
    const whole = Math.floor(grain.position);
    const fraction = grain.position - whole;
    const at = whole & this.mask;
    const next = (whole + 1) & this.mask;
    // Before the first input, there is nothing to read.
    if (whole >= 0 && gain > 0) {
      for (let channel = 0; channel < output.length; channel++) {
        const line = this.history[channel];
        output[channel][index] +=
          gain * (line[at] + (line[next] - line[at]) * fraction);
      }
    }
    grain.position += grain.rate;
    grain.age++;
    if (grain.fadeLength && --grain.fade <= 0) {
      grain.active = false;
    } else if (grain.age >= this.grainLength) {
      grain.active = false;
    }
  }
}
