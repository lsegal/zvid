import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FormantShifter } from "./formants.ts";
import { rePitchFrameSize, rePitchRate } from "./re-pitch.ts";

const SAMPLE_RATE = 48_000;
const BLOCK = 128;

// `input` shifted by `semitones` at 48 kHz, frame by frame as the chain
// runs it.
function shift(input: Float32Array, semitones: number, formants: number) {
  const shifter = new FormantShifter(
    SAMPLE_RATE,
    1,
    rePitchFrameSize(SAMPLE_RATE),
  );
  const output = new Float32Array(input.length);
  const steps = new Float32Array(BLOCK).fill(semitones);
  const cents = new Float32Array(BLOCK);
  for (let start = 0; start < input.length; start += BLOCK) {
    shifter.process(
      [input.subarray(start, start + BLOCK)],
      [output.subarray(start, start + BLOCK)],
      BLOCK,
      steps,
      cents,
      formants,
    );
  }
  return output;
}

// The level of `hz` in the second half of `output`.
function level(output: Float32Array, hz: number) {
  let real = 0;
  let imaginary = 0;
  const start = output.length / 2;
  for (let index = start; index < output.length; index++) {
    const angle = (2 * Math.PI * hz * index) / SAMPLE_RATE;
    real += output[index] * Math.cos(angle);
    imaginary += output[index] * Math.sin(angle);
  }
  return (2 * Math.hypot(real, imaginary)) / (output.length - start);
}

describe("Re-Pitch's Formants algorithm at 48 kHz", () => {
  // Within 1.5 dB.
  it("keeps a lone tone's level, whose envelope is just its own peak", () => {
    const input = new Float32Array(SAMPLE_RATE);
    for (let index = 0; index < input.length; index++) {
      input[index] = 0.3 * Math.sin((2 * Math.PI * 440 * index) / SAMPLE_RATE);
    }
    for (const semitones of [12, 7, -7, -12]) {
      for (const formants of [0, 1]) {
        const output = shift(input, semitones, formants);
        const hz = 440 * rePitchRate(semitones);
        assert.ok(
          Math.abs(level(output, hz) - 0.3) < 0.05,
          `${semitones} st at ${formants}: ${level(output, hz)}`,
        );
        assert.ok(level(output, 440) < 0.01, `${semitones} st at ${formants}`);
      }
    }
  });

  it("keeps a resonance in place while its harmonics move", () => {
    // A 150 Hz pulse train through a resonance at 1200 Hz.
    const input = new Float32Array(SAMPLE_RATE);
    const radius = 0.995;
    const theta = (2 * Math.PI * 1200) / SAMPLE_RATE;
    let y1 = 0;
    let y2 = 0;
    for (let index = 0; index < input.length; index++) {
      const pulse = index % (SAMPLE_RATE / 150) === 0 ? 0.01 : 0;
      const y =
        pulse + 2 * radius * Math.cos(theta) * y1 - radius * radius * y2;
      y2 = y1;
      y1 = y;
      input[index] = y;
    }
    const loudest = (output: Float32Array, pitch: number) => {
      let best = 0;
      for (let hz = pitch; hz < 4000; hz += pitch) {
        if (level(output, hz) > level(output, best)) {
          best = hz;
        }
      }
      return best;
    };
    for (const semitones of [7, -7]) {
      const pitch = 150 * rePitchRate(semitones);
      const kept = loudest(shift(input, semitones, 1), pitch);
      const moved = loudest(shift(input, semitones, 0), pitch);
      assert.ok(Math.abs(kept - 1200) < pitch, `${semitones} kept ${kept}`);
      assert.ok(
        Math.abs(moved - 1200 * rePitchRate(semitones)) < pitch,
        `${semitones} moved ${moved}`,
      );
    }
  });
});
