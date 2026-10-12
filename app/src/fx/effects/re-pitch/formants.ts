// Re-Pitch's Formants algorithm: a phase vocoder that shifts pitch without
// changing timing, keeping the sound's spectral envelope in place.
//
// Every hop (a quarter frame) it takes the last frame of input through a
// Hann window and an FFT, works out each bin's true frequency from how far
// its phase moved since the last frame, and moves each bin's magnitude to
// the bin at its frequency times the ratio, at that frequency. Before the
// move it divides each magnitude by the spectral envelope (the log spectrum
// smoothed by keeping only its first cepstral coefficients), and after it
// multiplies the envelope back in: at Formants 100% the envelope stays
// where it was, so a voice's formants do not move with its pitch; at 0% the
// envelope moves with it, as a plain phase vocoder does. The inverse FFT is
// windowed again and overlap-added into the output, a frame late.
import { Fft } from "./fft.ts";
import { rePitchRate } from "./re-pitch.ts";

// Frames overlap four times.
const OVERLAP = 4;
// The smallest magnitude the envelope works with, so silent bins neither
// divide by zero nor take the log of it.
const FLOOR = 1e-9;
// The quefrency below which the cepstrum is kept as envelope: 1.5 ms, under
// the pitch period of voices and most instruments.
const ENVELOPE_SECONDS = 0.0015;

function wrapPhase(phase: number) {
  return phase - 2 * Math.PI * Math.round(phase / (2 * Math.PI));
}

type ChannelState = {
  // The last frame of input, oldest first.
  input: Float64Array;
  // The output from the last frame's start on, overlap-added.
  output: Float64Array;
  // Each bin's analysis phase in the last frame, and the phase it was last
  // synthesized at.
  lastPhase: Float64Array;
  sumPhase: Float64Array;
};

export class FormantShifter {
  readonly frameSize: number;
  private readonly hop: number;
  private readonly lifter: number;
  private readonly fft: Fft;
  private readonly window: Float64Array;
  // The window's gain once applied twice and overlap-added, undone.
  private readonly scale: number;
  private readonly channels: ChannelState[];
  // Scratch, shared by every channel.
  private readonly real: Float64Array;
  private readonly imaginary: Float64Array;
  private readonly envelopeReal: Float64Array;
  private readonly envelopeImaginary: Float64Array;
  private readonly magnitude: Float64Array;
  private readonly phase: Float64Array;
  private readonly frequency: Float64Array;
  private readonly envelope: Float64Array;
  private readonly shiftedMagnitude: Float64Array;
  private readonly shiftedFrequency: Float64Array;
  private readonly shiftedLoudest: Float64Array;
  // Frames since the last hop.
  private filled = 0;
  // Whether a frame has been analyzed since the last reset.
  private started = false;

  constructor(sampleRate: number, channels: number, frameSize: number) {
    this.frameSize = frameSize;
    this.hop = frameSize / OVERLAP;
    this.lifter = Math.min(
      frameSize / 4,
      Math.max(4, Math.round(sampleRate * ENVELOPE_SECONDS)),
    );
    this.fft = new Fft(frameSize);
    this.window = new Float64Array(frameSize);
    let power = 0;
    for (let index = 0; index < frameSize; index++) {
      const value = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / frameSize);
      this.window[index] = value;
      power += value * value;
    }
    this.scale = this.hop / power;
    const bins = frameSize / 2 + 1;
    this.channels = Array.from({ length: channels }, () => ({
      input: new Float64Array(frameSize),
      output: new Float64Array(frameSize),
      lastPhase: new Float64Array(bins),
      sumPhase: new Float64Array(bins),
    }));
    this.real = new Float64Array(frameSize);
    this.imaginary = new Float64Array(frameSize);
    this.envelopeReal = new Float64Array(frameSize);
    this.envelopeImaginary = new Float64Array(frameSize);
    this.magnitude = new Float64Array(bins);
    this.phase = new Float64Array(bins);
    this.frequency = new Float64Array(bins);
    this.envelope = new Float64Array(bins);
    this.shiftedMagnitude = new Float64Array(bins);
    this.shiftedFrequency = new Float64Array(bins);
    this.shiftedLoudest = new Float64Array(bins);
  }

  // Shifts `frames` frames of `input` into `output`, frameSize frames late,
  // by `semitones` plus `cents` at each frame. `formants` is the share of
  // the envelope kept in place, 0 to 1.
  process(
    input: readonly Float32Array[],
    output: Float32Array[],
    frames: number,
    semitones: Float32Array,
    cents: Float32Array,
    formants: number,
  ) {
    const { hop, frameSize } = this;
    for (let index = 0; index < frames; index++) {
      for (let channel = 0; channel < this.channels.length; channel++) {
        const state = this.channels[channel];
        state.input[frameSize - hop + this.filled] = input[channel][index];
        output[channel][index] = state.output[this.filled];
      }
      this.filled++;
      if (this.filled === hop) {
        this.filled = 0;
        const frameRatio = rePitchRate(semitones[index], cents[index]);
        for (const state of this.channels) {
          state.output.copyWithin(0, hop);
          state.output.fill(0, frameSize - hop);
          this.shiftFrame(state, frameRatio, formants);
          state.input.copyWithin(0, hop);
        }
        this.started = true;
      }
    }
  }

  reset() {
    for (const state of this.channels) {
      state.input.fill(0);
      state.output.fill(0);
      state.lastPhase.fill(0);
      state.sumPhase.fill(0);
    }
    this.filled = 0;
    this.started = false;
  }

  private shiftFrame(state: ChannelState, ratio: number, formants: number) {
    const { frameSize, hop, real, imaginary, window } = this;
    const half = frameSize / 2;
    for (let index = 0; index < frameSize; index++) {
      real[index] = state.input[index] * window[index];
      imaginary[index] = 0;
    }
    this.fft.forward(real, imaginary);
    // Each bin's magnitude, phase and true frequency, in bins.
    const expected = (2 * Math.PI * hop) / frameSize;
    for (let bin = 0; bin <= half; bin++) {
      const magnitude = Math.hypot(real[bin], imaginary[bin]);
      const phase = Math.atan2(imaginary[bin], real[bin]);
      const drift = wrapPhase(phase - state.lastPhase[bin] - bin * expected);
      state.lastPhase[bin] = phase;
      this.magnitude[bin] = magnitude;
      this.phase[bin] = phase;
      this.frequency[bin] = bin + drift / expected;
    }
    const keepEnvelope = formants > 0 && ratio !== 1;
    if (keepEnvelope) {
      this.findEnvelope();
    }
    const { shiftedMagnitude, shiftedFrequency, shiftedLoudest, envelope } =
      this;
    shiftedMagnitude.fill(0);
    shiftedFrequency.fill(0);
    shiftedLoudest.fill(0);
    for (let bin = 0; bin <= half; bin++) {
      const target = Math.round(bin * ratio);
      if (target > half) {
        break;
      }
      // Its fine structure, with the envelope taken out.
      const fine = keepEnvelope
        ? this.magnitude[bin] / envelope[bin]
        : this.magnitude[bin];
      shiftedMagnitude[target] += fine;
      if (fine >= shiftedLoudest[target]) {
        shiftedLoudest[target] = fine;
        shiftedFrequency[target] = this.frequency[bin] * ratio;
      }
    }
    for (let bin = 0; bin <= half; bin++) {
      let magnitude = shiftedMagnitude[bin];
      if (keepEnvelope) {
        // The envelope where it was, and where it moved to with the pitch.
        const kept = envelope[bin];
        const moved = this.envelopeAt(bin / ratio);
        magnitude *= kept ** formants * moved ** (1 - formants);
      }
      if (ratio === 1 || !this.started) {
        // Unshifted, or the first frame: the input's own phase, so it
        // plays back as it was.
        state.sumPhase[bin] = this.phase[bin];
      } else {
        state.sumPhase[bin] = wrapPhase(
          state.sumPhase[bin] + shiftedFrequency[bin] * expected,
        );
      }
      real[bin] = magnitude * Math.cos(state.sumPhase[bin]);
      imaginary[bin] = magnitude * Math.sin(state.sumPhase[bin]);
    }
    for (let bin = half + 1; bin < frameSize; bin++) {
      real[bin] = real[frameSize - bin];
      imaginary[bin] = -imaginary[frameSize - bin];
    }
    this.fft.inverse(real, imaginary);
    for (let index = 0; index < frameSize; index++) {
      state.output[index] += real[index] * window[index] * this.scale;
    }
  }

  // Smooths the frame's log magnitudes into its spectral envelope, keeping
  // its cepstrum's first `lifter` coefficients.
  private findEnvelope() {
    const { frameSize, lifter, envelopeReal, envelopeImaginary } = this;
    const half = frameSize / 2;
    for (let bin = 0; bin <= half; bin++) {
      const log = Math.log(Math.max(FLOOR, this.magnitude[bin]));
      envelopeReal[bin] = log;
      if (bin > 0 && bin < half) {
        envelopeReal[frameSize - bin] = log;
      }
    }
    envelopeImaginary.fill(0);
    this.fft.inverse(envelopeReal, envelopeImaginary);
    envelopeReal.fill(0, lifter + 1, frameSize - lifter);
    envelopeImaginary.fill(0);
    this.fft.forward(envelopeReal, envelopeImaginary);
    for (let bin = 0; bin <= half; bin++) {
      this.envelope[bin] = Math.max(FLOOR, Math.exp(envelopeReal[bin]));
    }
  }

  // The envelope at fractional bin `bin`, interpolated; past the top bin it
  // holds the top bin's value.
  private envelopeAt(bin: number) {
    const half = this.frameSize / 2;
    if (bin >= half) {
      return this.envelope[half];
    }
    const below = Math.floor(bin);
    const above = this.envelope[below + 1];
    return this.envelope[below] + (above - this.envelope[below]) * (bin - below);
  }
}
