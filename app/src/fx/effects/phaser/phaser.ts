// The Phaser effect's DSP: a chain of first-order all-pass filters whose
// shared break frequency a sine LFO sweeps around Center, with feedback
// from the chain's output to its input, mixed with the dry signal. Where
// the chain turns the phase by an odd multiple of 180° the wet signal
// cancels the dry one, so N stages make N/2 notches. The LFO phase is the
// timeline time times the rate, so the preview and an export sweep
// identically.

export const PHASER_EFFECT_NAME = "Phaser";

export const RATE_KEY = "Rate";
export const DEPTH_KEY = "Depth";
export const STAGES_KEY = "Stages";
export const CENTER_KEY = "Center";
export const FEEDBACK_KEY = "Feedback";
export const MIX_KEY = "Mix";

export const PHASER_RANGES = {
  // Hz.
  [RATE_KEY]: { min: 0.05, max: 10, defaultValue: 0.5 },
  // Percent.
  [DEPTH_KEY]: { min: 0, max: 100, defaultValue: 70 },
  // Hz.
  [CENTER_KEY]: { min: 200, max: 5000, defaultValue: 1000 },
  // Percent.
  [FEEDBACK_KEY]: { min: 0, max: 90, defaultValue: 30 },
  // Percent.
  [MIX_KEY]: { min: 0, max: 100, defaultValue: 50 },
} as const;

export type PhaserNumberKey = keyof typeof PHASER_RANGES;

export const STAGE_OPTIONS = ["2", "4", "6", "8", "12"] as const;
export const STAGES_DEFAULT = "4";
export const MAX_STAGES = 12;

// Depth 100 % sweeps the break frequency this many octaves either side of
// Center.
export const SWEEP_OCTAVES = 2;

// After a live Rate change the LFO keeps its phase, then drifts back into
// step with the timeline over about this long, so playback after the edit
// matches an export again.
export const PHASE_RELOCK_SECONDS = 0.5;

// Below this many cycles the drift back counts as done.
const PHASE_LOCKED = 1e-9;

// The lowest break frequency, so a swept stage stays well-behaved.
const MIN_BREAK_HZ = 10;

// The feedback loop rings down 60 dB after this many passes' worth of its
// gain.
const FEEDBACK_SILENCE = Math.log(0.001);

// "0.50 Hz", "2.5 Hz".
export function formatRate(hz: number) {
  return `${hz < 1 ? hz.toFixed(2) : hz.toFixed(1)} Hz`;
}

// "200 Hz", "1.50 kHz".
export function formatFrequency(hz: number) {
  return hz < 1000 ? `${Math.round(hz)} Hz` : `${(hz / 1000).toFixed(2)} kHz`;
}

export function formatPercent(percent: number) {
  return `${Math.round(percent)}%`;
}

// The stage count a stored Stages value names, or the default's.
export function stageCount(value: string | undefined) {
  const count = Number.parseInt(value ?? "", 10);
  return (STAGE_OPTIONS as readonly string[]).includes(String(count))
    ? count
    : Number(STAGES_DEFAULT);
}

// The LFO's phase in cycles at timeline second `seconds`.
export function phaserPhase(seconds: number, rate: number) {
  return seconds * rate;
}

// The stages' break frequency in Hz at LFO phase `phase` (in cycles).
export function breakFrequency(center: number, depth: number, phase: number) {
  const octaves = (depth / 100) * SWEEP_OCTAVES * Math.sin(2 * Math.PI * phase);
  return center * 2 ** octaves;
}

// A first-order all-pass's coefficient for break frequency `hz`: its
// transfer function is (c + z⁻¹) / (1 + c·z⁻¹), turning the phase by 90°
// at `hz`.
export function allPassCoefficient(hz: number, sampleRate: number) {
  const f = Math.min(sampleRate * 0.45, Math.max(MIN_BREAK_HZ, hz));
  const t = Math.tan((Math.PI * f) / sampleRate);
  return (t - 1) / (t + 1);
}

// The frequencies of the notches a still sweep (Depth 0) makes: where the
// chain's phase reaches an odd multiple of 180°, lowest first.
export function notchFrequencies(
  center: number,
  stages: number,
  sampleRate: number,
) {
  const t = Math.tan((Math.PI * center) / sampleRate);
  const notches: number[] = [];
  for (let k = 0; 2 * k + 1 < stages; k++) {
    const half = Math.atan(
      t * Math.tan((Math.PI * (2 * k + 1)) / (2 * stages)),
    );
    notches.push((half * sampleRate) / Math.PI);
  }
  return notches;
}

// The wet path's gain, so that at Mix 50 % the wet signal cancels the dry
// one exactly at a notch whatever the feedback: feedback then deepens the
// notches against the peaks it raises between them.
function wetGain(feedback: number) {
  return 1 + feedback;
}

// The phaser's magnitude response in dB at `frequency` with the sweep
// still at break frequency `hz`, for tests and displays.
export function phaserResponseDb(
  settings: { hz: number; stages: number; feedback: number; mix: number },
  frequency: number,
  sampleRate: number,
) {
  const c = allPassCoefficient(settings.hz, sampleRate);
  const w = (2 * Math.PI * frequency) / sampleRate;
  // One stage at z = e^jw: (c + e^-jw) / (1 + c·e^-jw).
  const nRe = c + Math.cos(w);
  const nIm = -Math.sin(w);
  const dRe = 1 + c * Math.cos(w);
  const dIm = -c * Math.sin(w);
  const stagePhase = Math.atan2(nIm, nRe) - Math.atan2(dIm, dRe);
  const phase = stagePhase * settings.stages;
  // The chain is A = e^jφ; with feedback the wet path is A / (1 − fb·A).
  const fb = settings.feedback / 100;
  const aRe = Math.cos(phase);
  const aIm = Math.sin(phase);
  const denRe = 1 - fb * aRe;
  const denIm = -fb * aIm;
  const den = denRe * denRe + denIm * denIm;
  const wetRe = (aRe * denRe + aIm * denIm) / den;
  const wetIm = (aIm * denRe - aRe * denIm) / den;
  const mix = settings.mix / 100;
  const g = mix * wetGain(fb);
  const re = 1 - mix + g * wetRe;
  const im = g * wetIm;
  return 10 * Math.log10(re * re + im * im);
}

// How long the phaser keeps sounding once its input falls silent: the
// chain's group delay at its lowest break frequency, once for each
// feedback pass until the loop decays by 60 dB.
export function phaserTailSeconds(
  center: number,
  depth: number,
  stages: number,
  feedback: number,
) {
  const lowest = Math.max(
    MIN_BREAK_HZ,
    center * 2 ** (-(depth / 100) * SWEEP_OCTAVES),
  );
  const chainSeconds = stages / (Math.PI * lowest);
  const fb = feedback / 100;
  const passes = fb > 0 ? Math.ceil(FEEDBACK_SILENCE / Math.log(fb)) : 0;
  return chainSeconds * (1 + passes);
}

// `cycles` less its nearest whole number of cycles, in -0.5..0.5.
function wrapCycles(cycles: number) {
  return cycles - Math.round(cycles);
}

export type PhaserBlock = {
  frames: number;
  // The timeline second of the block's first frame.
  timeSeconds: number;
  stages: number;
  // Each number parameter's value at every frame.
  rate: Float32Array;
  depth: Float32Array;
  center: Float32Array;
  feedback: Float32Array;
  mix: Float32Array;
};

export class PhaserDsp {
  readonly sampleRate: number;
  // Per channel: each all-pass stage's memory.
  private readonly state: Float64Array[];
  private lastStages = 0;
  // Cycles added to the timeline phase to keep it continuous across a live
  // Rate change; it decays back to 0 over PHASE_RELOCK_SECONDS.
  private phaseOffset = 0;
  private lastRate: number | null = null;

  constructor(sampleRate: number, channels: number) {
    this.sampleRate = sampleRate;
    this.state = Array.from(
      { length: channels },
      () => new Float64Array(MAX_STAGES),
    );
  }

  process(
    input: readonly Float32Array[],
    output: Float32Array[],
    block: PhaserBlock,
  ) {
    const { frames, timeSeconds, stages } = block;
    const sampleRate = this.sampleRate;
    const relock = Math.exp(-1 / (PHASE_RELOCK_SECONDS * sampleRate));
    if (stages !== this.lastStages) {
      // A different chain starts from rest.
      for (const z of this.state) {
        z.fill(0);
      }
      this.lastStages = stages;
    }
    for (let index = 0; index < frames; index++) {
      const seconds = timeSeconds + index / sampleRate;
      const rate = block.rate[index];
      if (this.lastRate !== null && rate !== this.lastRate) {
        // Keep the phase where it was at this instant under the new rate.
        this.phaseOffset = wrapCycles(
          this.phaseOffset + seconds * (this.lastRate - rate),
        );
      } else if (this.phaseOffset !== 0) {
        this.phaseOffset *= relock;
        if (Math.abs(this.phaseOffset) < PHASE_LOCKED) {
          this.phaseOffset = 0;
        }
      }
      this.lastRate = rate;

      const phase = phaserPhase(seconds, rate) + this.phaseOffset;
      const c = allPassCoefficient(
        breakFrequency(block.center[index], block.depth[index], phase),
        sampleRate,
      );
      // The chain's instant gain from its input to its output.
      const instant = c ** stages;
      const fb = block.feedback[index] / 100;
      const mix = block.mix[index] / 100;
      const g = wetGain(fb);
      for (let channel = 0; channel < output.length; channel++) {
        const z = this.state[channel];
        const dry = input[channel][index];
        // The chain's output with no input this frame, from its memory.
        let held = 0;
        for (let stage = 0; stage < stages; stage++) {
          held = c * held + z[stage];
        }
        // Solves the loop without a frame of delay: wet = instant·(dry +
        // fb·wet) + held.
        const wet = (instant * dry + held) / (1 - fb * instant);
        let x = dry + fb * wet;
        for (let stage = 0; stage < stages; stage++) {
          const y = c * x + z[stage];
          z[stage] = x - c * y;
          x = y;
        }
        output[channel][index] = (1 - mix) * dry + mix * g * x;
      }
    }
  }
}
