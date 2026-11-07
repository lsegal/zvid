import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GAIN_EFFECT_NAME } from "../fx/effects/gain/gain.ts";
import {
  GLOBAL_EFFECT_TRACK_ID,
  sourceClipEffectTrackId,
  sourceTrackEffectTrackId,
} from "../fx/stack/clip-stacks.ts";
import { createEffect } from "../fx/stack/ops.ts";
import { DEFAULT_SYNTH_PARAMS } from "../midi-clip.ts";
import { createSynthEffect } from "../midi-effects.ts";
import { auditionChainSettings } from "./audition-chain.ts";

const clipStack = sourceClipEffectTrackId("clip");
const trackStack = sourceTrackEffectTrackId("track");
const synth = createSynthEffect(clipStack, DEFAULT_SYNTH_PARAMS);
const effect = (trackId: string, effectName: string) =>
  createEffect(trackId, effectName);

describe("auditionChainSettings", () => {
  it("runs the clip's stack, then the track's, then Global's, without the instrument", () => {
    const effects = [
      effect(GLOBAL_EFFECT_TRACK_ID, "Limiter"),
      effect(trackStack, "Reverb"),
      synth,
      effect(clipStack, GAIN_EFFECT_NAME),
      effect(sourceClipEffectTrackId("other"), "Delay"),
    ];
    const { stages, inputGain } = auditionChainSettings(
      effects,
      "track",
      "clip",
      true,
    );
    assert.deepEqual(
      stages.map((stage) => stage.effectName),
      [GAIN_EFFECT_NAME, "Reverb", "Limiter"],
    );
    assert.equal(inputGain, 1);
  });

  it("is silent without an enabled Gain on the clip's or track's stack, as in the mix", () => {
    const gain = effect(GLOBAL_EFFECT_TRACK_ID, GAIN_EFFECT_NAME);
    const off = {
      ...effect(trackStack, GAIN_EFFECT_NAME),
      enabled: false,
    };
    assert.equal(
      auditionChainSettings([synth, gain, off], "track", "clip", true)
        .inputGain,
      0,
    );
  });

  it("bypasses all but Global on a track with its FX off", () => {
    const { stages, inputGain } = auditionChainSettings(
      [
        effect(clipStack, "Reverb"),
        effect(trackStack, GAIN_EFFECT_NAME),
        effect(GLOBAL_EFFECT_TRACK_ID, "Limiter"),
      ],
      "track",
      "clip",
      false,
    );
    assert.deepEqual(
      stages.map((stage) => stage.enabled),
      [false, false, true],
    );
    assert.equal(inputGain, 1);
  });
});
