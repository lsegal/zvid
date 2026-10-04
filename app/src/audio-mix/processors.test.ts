import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EFFECT_DEFINITION_MODULES } from "../fx/effects/index.generated.ts";
import { EFFECT_AUDIO_PROCESSORS } from "../fx/effects/processors.generated.ts";
import { AudioChain, BLOCK_FRAMES, createBuffers } from "./chain.ts";
import { type AudioStage, DEFAULT_TIME_SIGNATURE } from "./processor.ts";
import { AUDIO_PROCESSORS } from "./processors.ts";

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const TEMPO = { bpm: 120, signature: DEFAULT_TIME_SIGNATURE };

// The effect at its defaults, as a chain stage.
function defaultStage(effectName: string): AudioStage {
  const module = EFFECT_DEFINITION_MODULES.find(
    (candidate) => candidate.definition.effectName === effectName,
  );
  assert.ok(module, `no definition for ${effectName}`);
  const numbers: Record<string, number> = {};
  const switches: Record<string, string> = {};
  for (const parameter of module.definition.parameters) {
    if (parameter.kind === "number") {
      numbers[parameter.key] = parameter.defaultValue;
    } else {
      switches[parameter.key] = parameter.defaultValue;
    }
  }
  return { id: "fx", effectName, enabled: true, numbers, switches };
}

// Deterministic noise in each channel, a different stream per seed.
function noise(frames: number, seed: number) {
  let state = seed;
  return Array.from({ length: CHANNELS }, () =>
    Float32Array.from({ length: frames }, () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return (state / 0xffffffff) * 2 - 1;
    }),
  );
}

function chainOf(stage: AudioStage) {
  const chain = new AudioChain(AUDIO_PROCESSORS, SAMPLE_RATE, CHANNELS);
  chain.configure({ stages: [stage], inputGain: 1, delayFrames: 0 }, TEMPO);
  return chain;
}

function run(chain: AudioChain, input: Float32Array[]) {
  const frames = input[0].length;
  const output = createBuffers(CHANNELS, frames);
  const out = createBuffers(CHANNELS, BLOCK_FRAMES);
  for (let block = 0; block < frames; block += BLOCK_FRAMES) {
    chain.process(
      input.map((channel) => channel.subarray(block, block + BLOCK_FRAMES)),
      out,
      BLOCK_FRAMES,
      block / SAMPLE_RATE,
    );
    for (let channel = 0; channel < CHANNELS; channel++) {
      output[channel].set(out[channel], block);
    }
  }
  return output;
}

describe("effect processors", () => {
  for (const { effectName } of EFFECT_AUDIO_PROCESSORS) {
    it(`${effectName} sounds after a reset exactly as when fresh`, () => {
      const stage = defaultStage(effectName);
      const input = noise(64 * BLOCK_FRAMES, 2);
      const used = chainOf(stage);
      run(used, noise(64 * BLOCK_FRAMES, 1));
      used.reset();
      assert.deepEqual(run(used, input), run(chainOf(stage), input));
    });
  }
});
