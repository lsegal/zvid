export type AudioBands = {
  // Smoothed band level, 0..1.
  low: number;
  high: number;
  // Detected onsets, 0..1: jumps on a hit and decays quickly between hits.
  impulseLow: number;
  impulseHigh: number;
  // Hits detected in the last ONSET_MEMORY_SECONDS, oldest first, each at
  // the stronger of the two bands' strengths.
  onsets?: readonly AudioOnset[];
};

export type AudioOnset = {
  // Seconds from the hit to the moment the bands describe.
  secondsAgo: number;
  // 0..1.
  strength: number;
};

export const SILENT_AUDIO_BANDS: AudioBands = {
  low: 0,
  high: 0,
  impulseLow: 0,
  impulseHigh: 0,
  onsets: [],
};

const FFT_SIZE = 1024;
const LOW_BAND_MAX_HZ = 250;
const HIGH_BAND_MIN_HZ = 2000;
const HIGH_BAND_MAX_HZ = 10000;
// Per-frame envelope coefficients at the reference rate. They are rescaled by
// the real frame duration so preview and export agree at any frame rate.
const ENVELOPE_ATTACK = 0.6;
const ENVELOPE_RELEASE = 0.1;
const ENVELOPE_REFERENCE_FPS = 60;
const MAX_ENVELOPE_STEP_SECONDS = 0.25;
// AnalyserNode defaults, reproduced offline so export matches the preview.
const MIN_DECIBELS = -100;
const MAX_DECIBELS = -30;
// Onset detection runs once per tick of the reference-rate grid. A band's
// onset function is its positive spectral flux: the mean rise of its bins
// since the previous tick, as a fraction of full scale. A tick is a hit when
// the flux beats `mean + k * stddev` of the flux over the preceding window
// (and a floor, so near-silence never fires), outside the refractory period
// of the previous hit.
const ONSET_WINDOW_SECONDS = 0.75;
const ONSET_THRESHOLD_DEVIATIONS = 2.5;
const ONSET_MIN_FLUX = 0.02;
const ONSET_REFRACTORY_SECONDS = 0.08;
// Flux above the threshold that gives a full-strength impulse.
const ONSET_FULL_STRENGTH_FLUX = 0.2;
// Time for an impulse to decay to 10% of its peak.
const IMPULSE_DECAY_SECONDS = 0.15;
// Offline envelopes are rebuilt from this much audio before a random seek.
// It must cover the onset window so seeks detect the same hits.
const OFFLINE_WARMUP_SECONDS = 1;
// How long a hit is remembered in `AudioBands.onsets`. It stays within the
// warm-up so seeks remember the same hits.
const ONSET_MEMORY_SECONDS = 1;

const TICK_SECONDS = 1 / ENVELOPE_REFERENCE_FPS;
const ONSET_WINDOW_TICKS = Math.round(
  ONSET_WINDOW_SECONDS * ENVELOPE_REFERENCE_FPS,
);
const ONSET_REFRACTORY_TICKS = Math.round(
  ONSET_REFRACTORY_SECONDS * ENVELOPE_REFERENCE_FPS,
);
const ONSET_MEMORY_TICKS = Math.round(
  ONSET_MEMORY_SECONDS * ENVELOPE_REFERENCE_FPS,
);

function bandBins(sampleRate: number, minimumHz: number, maximumHz: number) {
  const binHz = sampleRate / FFT_SIZE;
  // Bin 0 is DC, which carries no audible energy.
  const first = Math.max(1, Math.ceil(minimumHz / binHz));
  const last = Math.min(FFT_SIZE / 2 - 1, Math.ceil(maximumHz / binHz) - 1);
  return { first, last };
}

function bandMean(
  bins: Uint8Array,
  sampleRate: number,
  minimumHz: number,
  maximumHz: number,
) {
  const { first, last } = bandBins(sampleRate, minimumHz, maximumHz);
  if (last < first) {
    return 0;
  }

  let total = 0;
  for (let index = first; index <= last; index++) {
    total += bins[index];
  }

  return total / ((last - first + 1) * 255);
}

// Positive spectral flux: the mean rise of a band's bins since `previous`.
function bandFlux(
  bins: Uint8Array,
  previous: Uint8Array,
  sampleRate: number,
  minimumHz: number,
  maximumHz: number,
) {
  const { first, last } = bandBins(sampleRate, minimumHz, maximumHz);
  if (last < first) {
    return 0;
  }

  let total = 0;
  for (let index = first; index <= last; index++) {
    total += Math.max(0, bins[index] - previous[index]);
  }

  return total / ((last - first + 1) * 255);
}

function measureLevels(bins: Uint8Array, sampleRate: number) {
  return {
    low: bandMean(bins, sampleRate, 0, LOW_BAND_MAX_HZ),
    high: bandMean(bins, sampleRate, HIGH_BAND_MIN_HZ, HIGH_BAND_MAX_HZ),
  };
}

// Fast-attack, slow-release follower for the raw band levels.
class BandEnvelope {
  low = 0;
  high = 0;

  step(raw: { low: number; high: number }, elapsedSeconds: number) {
    const frames =
      Math.min(MAX_ENVELOPE_STEP_SECONDS, Math.max(0, elapsedSeconds)) *
      ENVELOPE_REFERENCE_FPS;
    this.low = follow(this.low, raw.low, frames);
    this.high = follow(this.high, raw.high, frames);
  }

  reset() {
    this.low = 0;
    this.high = 0;
  }
}

function follow(current: number, target: number, frames: number) {
  const coefficient = target > current ? ENVELOPE_ATTACK : ENVELOPE_RELEASE;
  const blend = 1 - (1 - coefficient) ** frames;
  return current + (target - current) * blend;
}

function decayImpulse(impulse: number, elapsedSeconds: number) {
  return impulse * 0.1 ** (Math.max(0, elapsedSeconds) / IMPULSE_DECAY_SECONDS);
}

// Adaptive-threshold onset detector and impulse envelope for one band,
// advanced one reference-rate tick at a time.
class OnsetDetector {
  private readonly history = new Float64Array(ONSET_WINDOW_TICKS);
  private historyCount = 0;
  private historyNext = 0;
  private refractoryTicks = 0;
  impulse = 0;

  // Steps one tick and returns the strength of the hit it detected, or 0.
  tick(flux: number) {
    let mean = 0;
    for (let index = 0; index < this.historyCount; index++) {
      mean += this.history[index];
    }
    mean /= Math.max(1, this.historyCount);
    let variance = 0;
    for (let index = 0; index < this.historyCount; index++) {
      variance += (this.history[index] - mean) ** 2;
    }
    variance /= Math.max(1, this.historyCount);
    const threshold = Math.max(
      ONSET_MIN_FLUX,
      mean + ONSET_THRESHOLD_DEVIATIONS * Math.sqrt(variance),
    );

    this.impulse = decayImpulse(this.impulse, TICK_SECONDS);
    let hit = 0;
    if (this.refractoryTicks > 0) {
      this.refractoryTicks -= 1;
    } else if (flux > threshold) {
      hit = Math.min(1, (flux - threshold) / ONSET_FULL_STRENGTH_FLUX);
      this.impulse = Math.max(this.impulse, hit);
      this.refractoryTicks = ONSET_REFRACTORY_TICKS;
    }

    this.history[this.historyNext] = flux;
    this.historyNext = (this.historyNext + 1) % ONSET_WINDOW_TICKS;
    this.historyCount = Math.min(ONSET_WINDOW_TICKS, this.historyCount + 1);
    return hit;
  }

  reset() {
    this.historyCount = 0;
    this.historyNext = 0;
    this.refractoryTicks = 0;
    this.impulse = 0;
  }
}

// Level envelopes and onset detectors for both bands. Onsets are detected on
// the fixed reference-rate grid, the same one OfflineAudioBands steps, so
// preview and export fire on the same hits at any frame rate.
export class AudioBandTracker {
  private readonly envelope = new BandEnvelope();
  private readonly lowOnsets = new OnsetDetector();
  private readonly highOnsets = new OnsetDetector();
  private readonly previous = new Uint8Array(FFT_SIZE / 2);
  private hasPrevious = false;
  // Seconds since the last onset tick, carried between live samples.
  private sinceTick = 0;
  // Ticks stepped since the last reset, and the hits among the latest of
  // them.
  private tickCount = 0;
  private hits: Array<{ tick: number; strength: number }> = [];

  // Feeds the latest analyser bins after `elapsedSeconds` of playback and
  // steps every grid tick that elapsed. Only the latest bins are known, so
  // the spectrum is held until the last of those ticks, which takes the
  // whole rise, as it would at the reference rate.
  advance(bins: Uint8Array, sampleRate: number, elapsedSeconds: number) {
    const elapsed = Math.min(
      MAX_ENVELOPE_STEP_SECONDS,
      Math.max(0, elapsedSeconds),
    );
    this.envelope.step(measureLevels(bins, sampleRate), elapsed);
    this.sinceTick += elapsed;
    // The epsilon absorbs rounding in frame times that land on the grid.
    const ticks = Math.floor(this.sinceTick / TICK_SECONDS + 1e-6);
    this.sinceTick = Math.max(0, this.sinceTick - ticks * TICK_SECONDS);
    for (let tick = 1; tick < ticks; tick++) {
      this.holdTick();
    }
    if (ticks > 0) {
      this.tickOnsets(bins, sampleRate);
    }
  }

  // Steps exactly one grid tick with the bins measured at that tick.
  step(bins: Uint8Array, sampleRate: number) {
    this.envelope.step(measureLevels(bins, sampleRate), TICK_SECONDS);
    this.tickOnsets(bins, sampleRate);
    this.sinceTick = 0;
  }

  // The bands `sinceTickSeconds` after the last tick, with the impulses
  // decayed over that gap. Defaults to the time carried by `advance`.
  bands(sinceTickSeconds = this.sinceTick): AudioBands {
    return {
      low: this.envelope.low,
      high: this.envelope.high,
      impulseLow: decayImpulse(this.lowOnsets.impulse, sinceTickSeconds),
      impulseHigh: decayImpulse(this.highOnsets.impulse, sinceTickSeconds),
      onsets: this.hits.map((hit) => ({
        secondsAgo:
          (this.tickCount - hit.tick) * TICK_SECONDS + sinceTickSeconds,
        strength: hit.strength,
      })),
    };
  }

  reset() {
    this.envelope.reset();
    this.lowOnsets.reset();
    this.highOnsets.reset();
    this.hasPrevious = false;
    this.sinceTick = 0;
    this.tickCount = 0;
    this.hits = [];
  }

  // A tick whose spectrum matches the previous one, so nothing rose.
  private holdTick() {
    if (this.hasPrevious) {
      this.lowOnsets.tick(0);
      this.highOnsets.tick(0);
    }
    this.recordHit(0);
  }

  private tickOnsets(bins: Uint8Array, sampleRate: number) {
    // The first spectrum after a reset has nothing to rise from.
    let hit = 0;
    if (this.hasPrevious) {
      const low = this.lowOnsets.tick(
        bandFlux(bins, this.previous, sampleRate, 0, LOW_BAND_MAX_HZ),
      );
      const high = this.highOnsets.tick(
        bandFlux(
          bins,
          this.previous,
          sampleRate,
          HIGH_BAND_MIN_HZ,
          HIGH_BAND_MAX_HZ,
        ),
      );
      hit = Math.max(low, high);
    }
    this.previous.set(bins);
    this.hasPrevious = true;
    this.recordHit(hit);
  }

  // Counts a tick, remembering it when it was a hit, and forgets hits older
  // than ONSET_MEMORY_SECONDS.
  private recordHit(strength: number) {
    this.tickCount += 1;
    if (strength > 0) {
      this.hits.push({ tick: this.tickCount, strength });
    }
    const oldest = this.tickCount - ONSET_MEMORY_TICKS;
    while (this.hits.length && this.hits[0].tick <= oldest) {
      this.hits.shift();
    }
  }
}

// An analyser set up the way LiveAudioBands measures it, and OfflineAudioBands
// reproduces: no temporal smoothing, the default decibel range.
export function createBandAnalyser(context: BaseAudioContext) {
  const analyser = context.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0;
  analyser.minDecibels = MIN_DECIBELS;
  analyser.maxDecibels = MAX_DECIBELS;
  return analyser;
}

// The program mix's left and right channels, before the preview volume, for
// the transport bar's VU meter. A mono mix reads the same on both.
export type MasterMeterTap = { left: AnalyserNode; right: AnalyserNode };

// The meter reads only the samples that arrived since its last frame, so
// each analyser keeps enough for frames up to about 340 ms apart at 48 kHz.
const METER_FFT_SIZE = 16384;

// Splits `context`'s input into one analyser per channel, upmixing mono to
// both sides first (a splitter alone would leave the right channel silent).
export function createMeterTap(context: BaseAudioContext) {
  const input = context.createGain();
  input.channelCount = 2;
  input.channelCountMode = "explicit";
  input.channelInterpretation = "speakers";
  const splitter = context.createChannelSplitter(2);
  input.connect(splitter);
  const [left, right] = [0, 1].map((channel) => {
    const analyser = context.createAnalyser();
    analyser.fftSize = METER_FFT_SIZE;
    analyser.smoothingTimeConstant = 0;
    splitter.connect(analyser, channel);
    return analyser;
  });
  return { input, tap: { left, right } as MasterMeterTap };
}

// Measures the preview's audio mix as it plays, through the analyser the
// mixer feeds it (see createBandAnalyser). The preview volume is a gain
// after the analyser, so the bands don't follow it.
export class LiveAudioBands {
  private bins = new Uint8Array(FFT_SIZE / 2);
  private tracker = new AudioBandTracker();
  private lastSampleMs: number | null = null;

  sample(analyser: AnalyserNode | null, nowMs: number): AudioBands {
    const elapsedSeconds =
      this.lastSampleMs === null ? 0 : (nowMs - this.lastSampleMs) / 1000;
    this.lastSampleMs = nowMs;
    if (!analyser) {
      this.tracker.reset();
      return SILENT_AUDIO_BANDS;
    }

    analyser.getByteFrequencyData(this.bins);
    this.tracker.advance(
      this.bins,
      analyser.context.sampleRate,
      elapsedSeconds,
    );
    return this.tracker.bands();
  }
}

// Reproduces the live analyser from decoded samples for offline rendering.
// The tracker advances on a fixed 60 Hz grid, so sequential export frames
// reuse the previous state instead of re-reading the warm-up window.
export class OfflineAudioBands {
  private readonly samples: Float32Array;
  private readonly sampleRate: number;
  private readonly window = new Float32Array(FFT_SIZE);
  private readonly real = new Float64Array(FFT_SIZE);
  private readonly imaginary = new Float64Array(FFT_SIZE);
  private readonly bins = new Uint8Array(FFT_SIZE / 2);
  private tracker = new AudioBandTracker();
  private envelopeStep = -1;

  constructor(samples: Float32Array, sampleRate: number) {
    this.samples = samples;
    this.sampleRate = sampleRate;
    for (let index = 0; index < FFT_SIZE; index++) {
      const phase = (2 * Math.PI * index) / FFT_SIZE;
      this.window[index] =
        0.42 - 0.5 * Math.cos(phase) + 0.08 * Math.cos(2 * phase);
    }
  }

  // Measures channels of the mix, down-mixed to mono the way Web Audio
  // down-mixes for analysis.
  static fromChannels(channels: readonly Float32Array[], sampleRate: number) {
    const mono = new Float32Array(channels[0]?.length ?? 0);
    for (const data of channels) {
      for (let index = 0; index < mono.length; index++) {
        mono[index] += data[index] / channels.length;
      }
    }
    return new OfflineAudioBands(mono, sampleRate);
  }

  at(timeSeconds: number): AudioBands {
    const targetStep = Math.max(
      0,
      Math.floor(timeSeconds * ENVELOPE_REFERENCE_FPS),
    );
    const warmupSteps = OFFLINE_WARMUP_SECONDS * ENVELOPE_REFERENCE_FPS;
    if (
      this.envelopeStep < 0 ||
      targetStep < this.envelopeStep ||
      targetStep - this.envelopeStep > warmupSteps
    ) {
      this.tracker.reset();
      this.envelopeStep = Math.max(0, targetStep - warmupSteps) - 1;
    }

    while (this.envelopeStep < targetStep) {
      this.envelopeStep += 1;
      this.tracker.step(
        this.measureAt(this.envelopeStep / ENVELOPE_REFERENCE_FPS),
        this.sampleRate,
      );
    }

    return this.tracker.bands(
      Math.max(0, timeSeconds) - targetStep * TICK_SECONDS,
    );
  }

  // Mirrors AnalyserNode.getByteFrequencyData with no temporal smoothing:
  // Blackman window, FFT scaled by 1/N, then decibels mapped onto 0..255.
  private measureAt(timeSeconds: number) {
    const end = Math.floor(timeSeconds * this.sampleRate);
    const start = end - FFT_SIZE;
    for (let index = 0; index < FFT_SIZE; index++) {
      const sampleIndex = start + index;
      const sample =
        sampleIndex >= 0 && sampleIndex < this.samples.length
          ? this.samples[sampleIndex]
          : 0;
      this.real[index] = sample * this.window[index];
      this.imaginary[index] = 0;
    }

    fft(this.real, this.imaginary);
    const scale = 255 / (MAX_DECIBELS - MIN_DECIBELS);
    for (let index = 0; index < this.bins.length; index++) {
      const magnitude =
        Math.hypot(this.real[index], this.imaginary[index]) / FFT_SIZE;
      const decibels = 20 * Math.log10(magnitude);
      const value = Math.floor(scale * (decibels - MIN_DECIBELS));
      this.bins[index] = Number.isFinite(value)
        ? Math.max(0, Math.min(255, value))
        : 0;
    }

    return this.bins;
  }
}

// In-place iterative radix-2 FFT; `real.length` must be a power of two.
function fft(real: Float64Array, imaginary: Float64Array) {
  const size = real.length;
  for (let index = 1, swap = 0; index < size; index++) {
    let bit = size >> 1;
    for (; swap & bit; bit >>= 1) {
      swap ^= bit;
    }
    swap ^= bit;
    if (index < swap) {
      [real[index], real[swap]] = [real[swap], real[index]];
      [imaginary[index], imaginary[swap]] = [imaginary[swap], imaginary[index]];
    }
  }

  for (let length = 2; length <= size; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    for (let offset = 0; offset < size; offset += length) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let index = 0; index < length / 2; index++) {
        const even = offset + index;
        const odd = even + length / 2;
        const oddReal =
          real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
        const oddImaginary =
          real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
        const nextReal =
          twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary =
          twiddleReal * stepImaginary + twiddleImaginary * stepReal;
        twiddleReal = nextReal;
      }
    }
  }
}
