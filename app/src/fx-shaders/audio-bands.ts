export type AudioBands = {
  low: number;
  high: number;
};

export const SILENT_AUDIO_BANDS: AudioBands = { low: 0, high: 0 };

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
// Offline envelopes are rebuilt from this much audio before a random seek.
const OFFLINE_WARMUP_SECONDS = 1;

function bandMean(
  bins: Uint8Array,
  sampleRate: number,
  minimumHz: number,
  maximumHz: number,
) {
  const binHz = sampleRate / FFT_SIZE;
  // Bin 0 is DC, which carries no audible energy.
  const first = Math.max(1, Math.ceil(minimumHz / binHz));
  const last = Math.min(bins.length - 1, Math.ceil(maximumHz / binHz) - 1);
  if (last < first) {
    return 0;
  }

  let total = 0;
  for (let index = first; index <= last; index++) {
    total += bins[index];
  }

  return total / ((last - first + 1) * 255);
}

function measureBands(bins: Uint8Array, sampleRate: number): AudioBands {
  return {
    low: bandMean(bins, sampleRate, 0, LOW_BAND_MAX_HZ),
    high: bandMean(bins, sampleRate, HIGH_BAND_MIN_HZ, HIGH_BAND_MAX_HZ),
  };
}

// Fast-attack, slow-release follower for the raw band levels.
class BandEnvelope {
  low = 0;
  high = 0;

  step(raw: AudioBands, elapsedSeconds: number) {
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

  get bands(): AudioBands {
    return { low: this.low, high: this.high };
  }
}

function follow(current: number, target: number, frames: number) {
  const coefficient = target > current ? ENVELOPE_ATTACK : ENVELOPE_RELEASE;
  const blend = 1 - (1 - coefficient) ** frames;
  return current + (target - current) * blend;
}

// Measures the main audio element as it plays through an AnalyserNode.
// Routing an element through Web Audio is permanent, so the graph is only
// built once effects actually need the bands.
export class LiveAudioBands {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private element: HTMLMediaElement | null = null;
  private bins = new Uint8Array(FFT_SIZE / 2);
  private envelope = new BandEnvelope();
  private lastSampleMs: number | null = null;

  attach(element: HTMLMediaElement | null) {
    if (element === this.element) {
      return;
    }

    this.source?.disconnect();
    this.source = null;
    this.element = element;
    if (!element) {
      return;
    }

    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.analyser = this.context.createAnalyser();
        this.analyser.fftSize = FFT_SIZE;
        this.analyser.smoothingTimeConstant = 0;
        this.analyser.minDecibels = MIN_DECIBELS;
        this.analyser.maxDecibels = MAX_DECIBELS;
        this.analyser.connect(this.context.destination);
      }
      this.source = this.context.createMediaElementSource(element);
      this.source.connect(this.analyser as AnalyserNode);
    } catch (error) {
      console.warn("Audio band analysis is unavailable.", error);
    }
  }

  // Browsers start an AudioContext suspended until a user gesture, and the
  // routed element stays silent until it resumes.
  resume() {
    if (this.context?.state === "suspended") {
      this.context.resume().catch(() => {});
    }
  }

  sample(nowMs: number): AudioBands {
    const elapsedSeconds =
      this.lastSampleMs === null ? 0 : (nowMs - this.lastSampleMs) / 1000;
    this.lastSampleMs = nowMs;
    if (!this.analyser || !this.context || !this.source) {
      this.envelope.reset();
      return SILENT_AUDIO_BANDS;
    }

    this.analyser.getByteFrequencyData(this.bins);
    this.envelope.step(
      measureBands(this.bins, this.context.sampleRate),
      elapsedSeconds,
    );
    return this.envelope.bands;
  }

  dispose() {
    this.source?.disconnect();
    this.source = null;
    this.element = null;
    this.analyser = null;
    this.context?.close().catch(() => {});
    this.context = null;
  }
}

// Reproduces the live analyser from decoded samples for offline rendering.
// The envelope advances on a fixed 60 Hz grid, so sequential export frames
// reuse the previous state instead of re-reading the warm-up window.
export class OfflineAudioBands {
  private readonly samples: Float32Array;
  private readonly sampleRate: number;
  private readonly window = new Float32Array(FFT_SIZE);
  private readonly real = new Float64Array(FFT_SIZE);
  private readonly imaginary = new Float64Array(FFT_SIZE);
  private readonly bins = new Uint8Array(FFT_SIZE / 2);
  private envelope = new BandEnvelope();
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

  static async decode(url: string) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Cannot read audio for effects (${response.status}).`);
    }

    const context = new OfflineAudioContext(1, 1, 48000);
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    // Web Audio down-mixes to mono for analysis by averaging channels.
    const mono = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < mono.length; index++) {
        mono[index] += data[index] / buffer.numberOfChannels;
      }
    }

    return new OfflineAudioBands(mono, buffer.sampleRate);
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
      this.envelope.reset();
      this.envelopeStep = Math.max(0, targetStep - warmupSteps) - 1;
    }

    while (this.envelopeStep < targetStep) {
      this.envelopeStep += 1;
      this.envelope.step(
        this.measureAt(this.envelopeStep / ENVELOPE_REFERENCE_FPS),
        1 / ENVELOPE_REFERENCE_FPS,
      );
    }

    return this.envelope.bands;
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

    return measureBands(this.bins, this.sampleRate);
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
