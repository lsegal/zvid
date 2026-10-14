import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sourceClipEffectTrackId } from "./fx/stack/clip-stacks.ts";
import type { SessionEffect } from "./fx/stack/types.ts";
import { DEFAULT_SYNTH_PARAMS, type SynthParams } from "./midi-clip.ts";
import {
  addDefaultSynth,
  auditionSynthOf,
  createArpeggiatorEffect,
  createSynthEffect,
  midiChainOf,
  migrateMidiClipEffects,
} from "./midi-effects.ts";
import { DEFAULT_ARPEGGIATOR } from "./note-generators.ts";

const STACK = sourceClipEffectTrackId("m");

const SQUARE: SynthParams = {
  ...DEFAULT_SYNTH_PARAMS,
  wave: "square",
  octave: -1,
  cutoff: 800,
  attack: 0.05,
  sustain: 0.4,
};

function gain(trackId: string, id = "gain"): SessionEffect {
  return { id, trackId, effectName: "Gain", parameters: [], enabled: true };
}

let nextId = 0;
const createId = () => `id-${++nextId}`;

describe("midiChainOf", () => {
  it("plays a stack's Arpeggiators in order, then its first enabled Synth", () => {
    const up = { ...DEFAULT_ARPEGGIATOR, rate: 0.5 as const };
    const random = {
      ...DEFAULT_ARPEGGIATOR,
      pattern: "random" as const,
      octaves: 3,
      enabled: false,
    };
    const chain = midiChainOf([
      { ...createSynthEffect(STACK, DEFAULT_SYNTH_PARAMS), enabled: false },
      createArpeggiatorEffect(STACK, up),
      gain(STACK),
      createSynthEffect(STACK, SQUARE),
      createArpeggiatorEffect(STACK, random),
      createSynthEffect(STACK, { ...SQUARE, wave: "sine" }),
    ]);
    assert.deepEqual(chain, { generators: [up, random], synth: SQUARE });
  });

  it("has nothing to play without an enabled Synth", () => {
    assert.equal(midiChainOf([]), undefined);
    assert.equal(
      midiChainOf([
        createArpeggiatorEffect(STACK, DEFAULT_ARPEGGIATOR),
        { ...createSynthEffect(STACK, SQUARE), enabled: false },
      ]),
      undefined,
    );
  });

  it("reads missing or invalid settings as their defaults", () => {
    const synth = createSynthEffect(STACK, undefined);
    assert.deepEqual(midiChainOf([synth])?.synth, DEFAULT_SYNTH_PARAMS);
    assert.deepEqual(
      midiChainOf([
        {
          ...createArpeggiatorEffect(STACK, DEFAULT_ARPEGGIATOR),
          parameters: [],
        },
        { ...synth, parameters: [{ key: "Wave", value: "Noise" }] },
      ]),
      { generators: [DEFAULT_ARPEGGIATOR], synth: DEFAULT_SYNTH_PARAMS },
    );
  });
});

describe("auditionSynthOf", () => {
  it("auditions through the enabled Synth, else a bypassed one", () => {
    assert.deepEqual(
      auditionSynthOf([
        { ...createSynthEffect(STACK, SQUARE), enabled: false },
        createSynthEffect(STACK, DEFAULT_SYNTH_PARAMS),
      ]),
      DEFAULT_SYNTH_PARAMS,
    );
    assert.deepEqual(
      auditionSynthOf([
        { ...createSynthEffect(STACK, SQUARE), enabled: false },
      ]),
      SQUARE,
    );
    assert.equal(auditionSynthOf([gain(STACK)]), undefined);
  });
});

describe("addDefaultSynth", () => {
  it("leads the clip's stack with a default Synth", () => {
    const effects = [gain("other"), gain(STACK, "own")];
    const next = addDefaultSynth(effects, "m", "synth");
    assert.deepEqual(
      next.map((effect) => [effect.id, effect.trackId]),
      [
        ["gain", "other"],
        ["synth", STACK],
        ["own", STACK],
      ],
    );
    assert.deepEqual(midiChainOf(next.slice(1))?.synth, DEFAULT_SYNTH_PARAMS);
  });
});

describe("migrateMidiClipEffects", () => {
  const spans = [
    { id: "m", sourceTrackId: "keys", notes: [] },
    { id: "plain", sourceTrackId: "pad", notes: [] },
    // Not a MIDI clip: an imported placeholder or a media clip.
    { id: "placeholder", sourceTrackId: "keys" },
  ];
  const arp = { ...DEFAULT_ARPEGGIATOR, pattern: "down" as const };
  const tracks = [
    { id: "keys", synth: SQUARE, noteGenerators: [arp] },
    { id: "pad" },
  ];

  it("moves each track's arpeggiator and synth onto its MIDI clips", () => {
    const effects = [gain(STACK)];
    const next = migrateMidiClipEffects(
      effects,
      tracks,
      spans,
      undefined,
      createId,
    );
    const stack = (spanId: string) =>
      next.filter(
        (effect) => effect.trackId === sourceClipEffectTrackId(spanId),
      );
    assert.deepEqual(
      stack("m").map((effect) => effect.effectName),
      ["Arpeggiator", "Synth", "Gain"],
    );
    assert.deepEqual(midiChainOf(stack("m")), {
      generators: [arp],
      synth: SQUARE,
    });
    // A track that never set its synth played the default one.
    assert.deepEqual(midiChainOf(stack("plain")), {
      generators: [],
      synth: DEFAULT_SYNTH_PARAMS,
    });
    assert.deepEqual(stack("placeholder"), []);
  });

  it("leaves a session saved with MIDI effects as it is", () => {
    const effects = [gain(STACK)];
    assert.equal(
      migrateMidiClipEffects(effects, tracks, spans, true, createId),
      effects,
    );
  });

  it("leaves a clip that already has a MIDI effect alone", () => {
    const own = createArpeggiatorEffect(STACK, DEFAULT_ARPEGGIATOR, "own");
    const next = migrateMidiClipEffects(
      [own],
      tracks,
      spans.slice(0, 1),
      undefined,
      createId,
    );
    assert.deepEqual(next, [own]);
  });
});
