import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { drumBankPadUrl, findDrumBank } from "./fx/effects/drum-rack/banks.ts";
import {
  DEFAULT_DRUM_RACK,
  DRUM_RACK_EFFECT_NAME,
  DRUM_RACK_KEY,
  formatDrumRack,
} from "./fx/effects/drum-rack/drum-rack.ts";
import { GRANULAR_EFFECT_NAME } from "./fx/effects/granular/granular.ts";
import { sourceClipEffectTrackId } from "./fx/stack/clip-stacks.ts";
import { createEffect, setEffectParameter } from "./fx/stack/ops.ts";
import type { SessionEffect } from "./fx/stack/types.ts";
import {
  DEFAULT_GRANULAR_PARAMS,
  DEFAULT_SYNTH_PARAMS,
  type MidiInstrument,
  type SynthParams,
} from "./midi-clip.ts";
import {
  addDefaultSynth,
  auditionInstrumentOf,
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

const asSynth = (params: SynthParams): MidiInstrument => ({
  kind: "synth",
  params,
});

// A Granular effect on the clip's stack, its Density set to `density`.
function granular(density?: number): SessionEffect {
  const effect = createEffect(STACK, GRANULAR_EFFECT_NAME);
  return density === undefined
    ? effect
    : setEffectParameter([effect], effect.id, "Density", density)[0];
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
    assert.deepEqual(chain, {
      generators: [up, random],
      instrument: asSynth(SQUARE),
    });
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
    assert.deepEqual(
      midiChainOf([synth])?.instrument,
      asSynth(DEFAULT_SYNTH_PARAMS),
    );
    assert.deepEqual(
      midiChainOf([
        {
          ...createArpeggiatorEffect(STACK, DEFAULT_ARPEGGIATOR),
          parameters: [],
        },
        { ...synth, parameters: [{ key: "Wave", value: "Noise" }] },
      ]),
      {
        generators: [DEFAULT_ARPEGGIATOR],
        instrument: asSynth(DEFAULT_SYNTH_PARAMS),
      },
    );
  });
});

describe("midiChainOf with a Granular", () => {
  it("plays through a Granular on its own", () => {
    assert.deepEqual(midiChainOf([granular()]), {
      generators: [],
      instrument: { kind: "granular", params: DEFAULT_GRANULAR_PARAMS },
    });
  });

  it("plays through the first enabled instrument, Synth or Granular", () => {
    assert.deepEqual(
      midiChainOf([granular(12), createSynthEffect(STACK, SQUARE)])?.instrument,
      { kind: "granular", params: { ...DEFAULT_GRANULAR_PARAMS, density: 12 } },
    );
    assert.deepEqual(
      midiChainOf([createSynthEffect(STACK, SQUARE), granular(12)])?.instrument,
      asSynth(SQUARE),
    );
    // A bypassed instrument leaves the next one to play.
    assert.deepEqual(
      midiChainOf([
        { ...createSynthEffect(STACK, SQUARE), enabled: false },
        granular(12),
      ])?.instrument,
      { kind: "granular", params: { ...DEFAULT_GRANULAR_PARAMS, density: 12 } },
    );
    assert.equal(midiChainOf([{ ...granular(), enabled: false }]), undefined);
  });
});

// A Drum Rack effect on the clip's stack, playing the bank `bankId`.
function drumRack(bankId?: string): SessionEffect {
  const effect = createEffect(STACK, DRUM_RACK_EFFECT_NAME);
  return bankId === undefined
    ? effect
    : setEffectParameter(
        [effect],
        effect.id,
        DRUM_RACK_KEY,
        formatDrumRack({ ...DEFAULT_DRUM_RACK, bank: bankId }),
      )[0];
}

describe("midiChainOf with a Drum Rack", () => {
  it("plays its bank's samples on its pads", () => {
    const bank = findDrumBank("builtin:cr-78");
    assert.ok(bank);
    const instrument = midiChainOf([drumRack(bank.id)])?.instrument;
    assert.deepEqual(instrument, {
      kind: "drums",
      params: { samples: bank.pads.map((_, pad) => drumBankPadUrl(bank, pad)) },
    });
    const fresh = midiChainOf([drumRack()])?.instrument;
    assert.equal(fresh?.kind, "drums");
    assert.match(
      fresh?.kind === "drums" ? String(fresh.params.samples[0]) : "",
      /^\/drum-banks\/tr-808\//,
    );
  });

  it("plays only as the first enabled instrument", () => {
    assert.deepEqual(
      midiChainOf([drumRack(), createSynthEffect(STACK, SQUARE)])?.instrument
        .kind,
      "drums",
    );
    assert.deepEqual(
      midiChainOf([{ ...drumRack(), enabled: false }, granular()])?.instrument
        .kind,
      "granular",
    );
    assert.equal(
      auditionInstrumentOf([{ ...drumRack(), enabled: false }])?.kind,
      "drums",
    );
  });
});

describe("auditionInstrumentOf", () => {
  it("auditions through the enabled instrument, else a bypassed one", () => {
    assert.deepEqual(
      auditionInstrumentOf([
        { ...createSynthEffect(STACK, SQUARE), enabled: false },
        createSynthEffect(STACK, DEFAULT_SYNTH_PARAMS),
      ]),
      asSynth(DEFAULT_SYNTH_PARAMS),
    );
    assert.deepEqual(
      auditionInstrumentOf([
        { ...createSynthEffect(STACK, SQUARE), enabled: false },
      ]),
      asSynth(SQUARE),
    );
    assert.deepEqual(
      auditionInstrumentOf([
        { ...createSynthEffect(STACK, SQUARE), enabled: false },
        granular(12),
      ]),
      { kind: "granular", params: { ...DEFAULT_GRANULAR_PARAMS, density: 12 } },
    );
    assert.equal(auditionInstrumentOf([gain(STACK)]), undefined);
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
    assert.deepEqual(
      midiChainOf(next.slice(1))?.instrument,
      asSynth(DEFAULT_SYNTH_PARAMS),
    );
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
      instrument: asSynth(SQUARE),
    });
    // A track that never set its synth played the default one.
    assert.deepEqual(midiChainOf(stack("plain")), {
      generators: [],
      instrument: asSynth(DEFAULT_SYNTH_PARAMS),
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
