// Re-Pitch's Formants algorithm: a phase vocoder that shifts pitch without
// changing timing, keeping the sound's spectral envelope in place.
//
// Every hop (a quarter frame) it takes the last frame of input through a
// Hann window and an FFT, finds the spectrum's peaks and works out each
// one's true frequency from how far its phase moved since the last frame.
// Each peak's region (the bins down to the quietest one between it and its
// neighbors) moves as a whole to the bin at the peak's frequency times the
// ratio, its phases rotated together so the peak advances at its new
// frequency: locking a region's phases to its peak keeps each partial's
// shape, level and attack rather than smearing it (Laroche and Dolson's
// peak-locked pitch shifting). Each moved bin is scaled by how the spectral
// envelope (the log spectrum smoothed by keeping only its first cepstral
// coefficients) differs between where it lands and where it came from: at
// Formants 100% the envelope stays where it was, so a voice's formants do
// not move with its pitch; at 0% the envelope moves with it, as a plain
// phase vocoder does. The frame is then scaled back to the power it had
// before that, so keeping the envelope reshapes the sound without making
// it louder or quieter: a lone tone, whose envelope is just its own peak,
// keeps its level. The inverse FFT is windowed again and overlap-added
// into the output, a frame late.
import { Fft } from "./fft.ts";
import { rePitchRate } from "./re-pitch.ts";

// Frames overlap four times.
const OVERLAP = 4;
// The smallest magnitude the envelope works with, so silent bins neither
// divide by zero nor take the log of it.
const FLOOR = 1e-9;
// The envelope follows nothing quieter than this share of the frame's
// loudest bin (−60 dB), so the deep floor around a lone tone does not turn
// into a steep envelope.
const ENVELOPE_RANGE = 1e-3;
// How far keeping the envelope may scale a bin (24 dB), and so how far the
// frame may be scaled back to restore its power.
const MAX_CORRECTION = 16;
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
  // Each bin's analysis phase in the last frame, and the phase its content
  // was synthesized at.
  lastPhase: Float64Array;
  synthesisPhase: Float64Array;
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
  private readonly envelope: Float64Array;
  private readonly shiftedReal: Float64Array;
  private readonly shiftedImaginary: Float64Array;
  private readonly peaks: Int32Array;
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
      synthesisPhase: new Float64Array(bins),
    }));
    this.real = new Float64Array(frameSize);
    this.imaginary = new Float64Array(frameSize);
    this.envelopeReal = new Float64Array(frameSize);
    this.envelopeImaginary = new Float64Array(frameSize);
    this.magnitude = new Float64Array(bins);
    this.phase = new Float64Array(bins);
    this.envelope = new Float64Array(bins);
    this.shiftedReal = new Float64Array(bins);
    this.shiftedImaginary = new Float64Array(bins);
    this.peaks = new Int32Array(bins);
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
        const ratio = rePitchRate(semitones[index], cents[index]);
        for (const state of this.channels) {
          state.output.copyWithin(0, hop);
          state.output.fill(0, frameSize - hop);
          this.shiftFrame(state, ratio, formants);
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
      state.synthesisPhase.fill(0);
    }
    this.filled = 0;
    this.started = false;
  }

  private shiftFrame(state: ChannelState, ratio: number, formants: number) {
    const frameSize = this.frameSize;
    const hop = this.hop;
    const real = this.real;
    const imaginary = this.imaginary;
    const window = this.window;
    const magnitude = this.magnitude;
    const phase = this.phase;
    const shiftedReal = this.shiftedReal;
    const shiftedImaginary = this.shiftedImaginary;
    const envelope = this.envelope;
    const peaks = this.peaks;
    const half = frameSize / 2;
    for (let index = 0; index < frameSize; index++) {
      real[index] = state.input[index] * window[index];
      imaginary[index] = 0;
    }
    this.fft.forward(real, imaginary);
    for (let bin = 0; bin <= half; bin++) {
      magnitude[bin] = Math.hypot(real[bin], imaginary[bin]);
      phase[bin] = Math.atan2(imaginary[bin], real[bin]);
    }
    const keepEnvelope = formants > 0 && ratio !== 1;
    if (keepEnvelope) {
      this.findEnvelope();
    }
    let peakCount = 0;
    for (let bin = 1; bin < half; bin++) {
      if (
        magnitude[bin] > magnitude[bin - 1] &&
        magnitude[bin] >= magnitude[bin + 1]
      ) {
        peaks[peakCount++] = bin;
      }
    }
    shiftedReal.fill(0);
    shiftedImaginary.fill(0);
    // The phase a bin's content advances by over a hop, per bin of
    // frequency.
    const advance = (2 * Math.PI * hop) / frameSize;
    // Unshifted, or on the first frame, a region keeps the input's own
    // phases, so it plays back as it was.
    const locked = ratio === 1 || !this.started;
    // The frame's power before and after keeping the envelope.
    let power = 0;
    let keptPower = 0;
    let start = 0;
    for (let index = 0; index < peakCount; index++) {
      const peak = peaks[index];
      // The region runs to the quietest bin before the next peak.
      let end = half;
      if (index + 1 < peakCount) {
        end = peak;
        for (let bin = peak + 1; bin < peaks[index + 1]; bin++) {
          if (magnitude[bin] < magnitude[end]) {
            end = bin;
          }
        }
      }
      const drift = wrapPhase(
        phase[peak] - state.lastPhase[peak] - peak * advance,
      );
      const frequency = peak + drift / advance;
      const shift = Math.round(frequency * (ratio - 1));
      const rotation = locked
        ? 0
        : wrapPhase(
            state.synthesisPhase[peak] +
              frequency * ratio * advance -
              phase[peak],
          );
      for (let bin = start; bin <= end; bin++) {
        const synthesis = phase[bin] + rotation;
        state.synthesisPhase[bin] = synthesis;
        const target = bin + shift;
        if (target < 0 || target > half) {
          continue;
        }
        let level = magnitude[bin];
        if (keepEnvelope) {
          power += level * level;
          const correction = envelope[target] / envelope[bin];
          level *=
            Math.min(
              MAX_CORRECTION,
              Math.max(1 / MAX_CORRECTION, correction),
            ) ** formants;
          keptPower += level * level;
        }
        shiftedReal[target] += level * Math.cos(synthesis);
        shiftedImaginary[target] += level * Math.sin(synthesis);
      }
      start = end + 1;
    }
    state.lastPhase.set(phase);
    const restore =
      keptPower > 0
        ? Math.min(
            MAX_CORRECTION,
            Math.max(1 / MAX_CORRECTION, Math.sqrt(power / keptPower)),
          )
        : 1;
    for (let bin = 0; bin <= half; bin++) {
      real[bin] = shiftedReal[bin] * restore;
      imaginary[bin] = shiftedImaginary[bin] * restore;
    }
    // DC and the top bin are real in a real signal.
    imaginary[0] = 0;
    imaginary[half] = 0;
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
    const frameSize = this.frameSize;
    const lifter = this.lifter;
    const envelopeReal = this.envelopeReal;
    const envelopeImaginary = this.envelopeImaginary;
    const half = frameSize / 2;
    let loudest = 0;
    for (let bin = 0; bin <= half; bin++) {
      loudest = Math.max(loudest, this.magnitude[bin]);
    }
    const floor = Math.max(FLOOR, loudest * ENVELOPE_RANGE);
    for (let bin = 0; bin <= half; bin++) {
      const log = Math.log(Math.max(floor, this.magnitude[bin]));
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
}
