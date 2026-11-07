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
import {
  type AuditionChainGraph,
  auditionChainGraph,
  auditionChainSettings,
  auditionTailSeconds,
  graphChains,
} from "./audition-chain.ts";

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

describe("auditionChainGraph", () => {
  const layerClip = (clipId: string, laneId: string) => ({
    clipId,
    laneId,
    laneFxEnabled: true,
    timeOffsetSeconds: 0,
  });
  const names = ({ settings }: AuditionChainGraph) =>
    settings.stages.map((stage) => stage.effectName);
  const effects = [
    effect(GLOBAL_EFFECT_TRACK_ID, "Limiter"),
    effect("lane", "Delay"),
    effect("other-lane", "Chorus"),
    effect(clipEffectTrackId("a"), "Reverb"),
    effect(clipEffectTrackId("b"), "Phaser"),
    effect(trackStack, GAIN_EFFECT_NAME),
  ];

  it("is a lone chain for no layer clip or one", () => {
    assert.deepEqual(auditionChainGraph(effects, "track", "clip", true, []), {
      settings: auditionChainSettings(effects, "track", "clip", true),
    });
    const only = layerClip("a", "lane");
    assert.deepEqual(
      auditionChainGraph(effects, "track", "clip", true, [only]),
      {
        settings: auditionChainSettings(effects, "track", "clip", true, only),
      },
    );
  });

  it("runs Global on the sum of the layers, each on the sum of its clips", () => {
    const graph = auditionChainGraph(effects, "track", "clip", true, [
      layerClip("a", "lane"),
      layerClip("b", "lane"),
      layerClip("c", "other-lane"),
    ]);
    assert.deepEqual(names(graph), ["Limiter"]);
    const [lane, otherLane] = graph.inputs ?? [];
    assert.deepEqual(names(lane), ["Delay"]);
    assert.deepEqual(names(otherLane), ["Chorus"]);
    assert.deepEqual(
      lane.inputs?.map((clip) => [clip.id, names(clip)]),
      [
        ["a", [GAIN_EFFECT_NAME, "Reverb"]],
        ["b", [GAIN_EFFECT_NAME, "Phaser"]],
      ],
    );
    assert.deepEqual(otherLane.inputs?.map(names), [[GAIN_EFFECT_NAME]]);
  });

  it("silences just the clip on a layer with its FX off", () => {
    const graph = auditionChainGraph(effects, "track", "clip", true, [
      layerClip("a", "lane"),
      { ...layerClip("c", "other-lane"), laneFxEnabled: false },
    ]);
    const clips = graph.inputs?.flatMap(({ inputs = [] }) => inputs);
    assert.deepEqual(
      clips?.map(({ settings }) => settings.inputGain),
      [1, 0],
    );
  });

  it("delays each clip to the slowest path, as the mix does", () => {
    const delays = graphChains(
      auditionChainGraph(
        [effect("lane", "Limiter"), effect("other-lane", "Delay")],
        "track",
        "clip",
        true,
        [layerClip("a", "lane"), layerClip("c", "other-lane")],
      ),
      48000,
    ).map(({ key, settings }) => [key, settings.delayFrames]);
    const delayOf = (key: string) =>
      delays.find(([chain]) => chain === key)?.[1];
    assert.equal(delayOf("/lane/a"), 0);
    assert.equal((delayOf("/other-lane/c") as number) > 0, true);
    assert.equal(delayOf("/lane"), 0);
    assert.equal(delayOf("/other-lane"), 0);
    assert.equal(delayOf(""), 0);
  });

  it("lasts as long as the longest path's tail", () => {
    const tail = (stages: string[]) =>
      auditionTailSeconds({
        trackId: "track",
        tempo: { bpm: 120, signature: { numerator: 4, denominator: 4 } },
        playheadSeconds: 0,
        ...auditionChainGraph(
          stages.map((name, index) => effect(`lane-${index}`, name)),
          "track",
          undefined,
          true,
          stages.map((_, index) => layerClip(`c${index}`, `lane-${index}`)),
        ),
      });
    assert.equal(tail(["Reverb", "Delay"]) > 0, true);
    assert.equal(
      tail(["Reverb", "Delay"]),
      Math.max(tail(["Reverb", "Reverb"]), tail(["Delay", "Delay"])),
    );
  });
});
