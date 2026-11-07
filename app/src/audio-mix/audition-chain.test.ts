import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GAIN_EFFECT_NAME } from "../fx/effects/gain/gain.ts";
import {
  clipEffectTrackId,
  GLOBAL_EFFECT_TRACK_ID,
  sourceClipEffectTrackId,
  sourceTrackEffectTrackId,
} from "../fx/stack/clip-stacks.ts";
import { createEffect } from "../fx/stack/ops.ts";
import {
  createDefaultModulation,
  type EffectModulation,
} from "../fx-modulation-defaults.ts";
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

  it("takes only the track's stack for a note with no clip (#1626)", () => {
    const track = sourceTrackEffectTrackId("track");
    const onClip = createEffect(sourceClipEffectTrackId("clip"), "Gain");
    const onTrack = createEffect(track, "Delay");
    assert.deepEqual(
      auditionChainSettings(
        [onClip, onTrack],
        "track",
        undefined,
        true,
      ).stages.map((stage) => stage.effectName),
      ["Delay"],
    );
    // The clip's Gain doesn't make a note played into the track sound.
    assert.equal(
      auditionChainSettings([onClip, onTrack], "track", undefined, true)
        .inputGain,
      0,
    );
  });

  describe("through a layer clip", () => {
    const layerClipStack = clipEffectTrackId("layer-clip");
    const layerClip = {
      clipId: "layer-clip",
      laneId: "lane",
      laneFxEnabled: true,
      timeOffsetSeconds: 2,
    };

    it("runs the source stacks, the layer clip's, its layer's, then Global's", () => {
      const { stages, inputGain } = auditionChainSettings(
        [
          effect(GLOBAL_EFFECT_TRACK_ID, "Limiter"),
          effect("lane", "Delay"),
          effect(layerClipStack, "Reverb"),
          synth,
          effect(clipStack, GAIN_EFFECT_NAME),
          effect(trackStack, "Compressor"),
          effect("other-lane", "Chorus"),
        ],
        "track",
        "clip",
        true,
        layerClip,
      );
      assert.deepEqual(
        stages.map((stage) => stage.effectName),
        ["Compressor", GAIN_EFFECT_NAME, "Reverb", "Delay", "Limiter"],
      );
      assert.equal(inputGain, 1);
    });

    it("counts a Gain on the layer clip's or layer's stack, as the mix does", () => {
      for (const stackId of [layerClipStack, "lane"]) {
        assert.equal(
          auditionChainSettings(
            [synth, effect(stackId, GAIN_EFFECT_NAME)],
            "track",
            "clip",
            true,
            layerClip,
          ).inputGain,
          1,
        );
      }
      assert.equal(
        auditionChainSettings([synth], "track", "clip", true, layerClip)
          .inputGain,
        0,
      );
    });

    it("is silent on a layer with its FX off, whatever Gains there are", () => {
      const { stages, inputGain } = auditionChainSettings(
        [
          effect(trackStack, GAIN_EFFECT_NAME),
          effect("lane", GAIN_EFFECT_NAME),
          effect(GLOBAL_EFFECT_TRACK_ID, "Limiter"),
        ],
        "track",
        "clip",
        true,
        { ...layerClip, laneFxEnabled: false },
      );
      assert.deepEqual(
        stages.map((stage) => stage.enabled),
        [false, false, true],
      );
      assert.equal(inputGain, 0);
    });

    it("runs only the source stacks' LFOs on the source track's time", () => {
      const withLfo = (trackId: string) => {
        const modulation = createDefaultModulation(
          GAIN_EFFECT_NAME,
        ) as EffectModulation;
        return {
          ...effect(trackId, GAIN_EFFECT_NAME),
          modulation: { ...modulation, enabled: true, mode: "lfo" as const },
        };
      };
      const { stages } = auditionChainSettings(
        [withLfo(trackStack), withLfo(clipStack), withLfo("lane")],
        "track",
        "clip",
        true,
        layerClip,
      );
      assert.deepEqual(
        stages.map((stage) =>
          stage.modulation?.mode === "lfo"
            ? stage.modulation.timeOffsetSeconds
            : undefined,
        ),
        [2, 2, undefined],
      );
    });
  });
});
