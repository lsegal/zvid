import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { drumBankPadUrl, findDrumBank } from "./fx/effects/drum-rack/banks.ts";
import {
  DEFAULT_DRUM_RACK,
  DRUM_RACK_EFFECT_NAME,
  DRUM_RACK_KEY,
  formatDrumRack,
} from "./fx/effects/drum-rack/drum-rack.ts";
import { GAIN_EFFECT_NAME } from "./fx/effects/gain/gain.ts";
import { GRANULAR_EFFECT_NAME } from "./fx/effects/granular/granular.ts";
import {
  sourceClipEffectTrackId,
  sourceTrackEffectTrackId,
} from "./fx/stack/clip-stacks.ts";
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
  addInstrumentTrackGain,
  auditionInstrumentOf,
  carryMovedClipInstruments,
  carryTrackInstrument,
  clipMidiStack,
  createArpeggiatorEffect,
  createSynthEffect,
  midiChainOf,
  migrateMidiClipEffects,
  migrateMidiTrackEffects,
} from "./midi-effects.ts";
import { DEFAULT_ARPEGGIATOR } from "./note-generators.ts";

const STACK = sourceClipEffectTrackId("m");
const TRACK = sourceTrackEffectTrackId("t");

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
  it("leads the track's stack with a default Synth", () => {
    const effects = [gain("other"), gain(TRACK, "own")];
    const next = addDefaultSynth(effects, "t", "synth");
    assert.deepEqual(
      next.map((effect) => [effect.id, effect.trackId]),
      [
        ["gain", "other"],
        ["synth", TRACK],
        ["own", TRACK],
      ],
    );
    assert.deepEqual(
      midiChainOf(next.slice(1))?.instrument,
      asSynth(DEFAULT_SYNTH_PARAMS),
    );
  });

  it("leaves a track that has an instrument as it is, even a bypassed one", () => {
    const effects = [
      { ...createSynthEffect(TRACK, SQUARE, "bypassed"), enabled: false },
    ];
    assert.equal(addDefaultSynth(effects, "t", "synth"), effects);
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

describe("addInstrumentTrackGain", () => {
  const synth = createSynthEffect(TRACK, SQUARE, "synth");

  it("gives a track with an instrument and no Gain one at its end", () => {
    assert.deepEqual(
      addInstrumentTrackGain([synth], TRACK, "added").map((effect) => [
        effect.id,
        effect.effectName,
      ]),
      [
        ["synth", synth.effectName],
        ["added", GAIN_EFFECT_NAME],
      ],
    );
  });

  it("leaves other stacks, and a track with a Gain or no instrument, alone", () => {
    const clip = [createSynthEffect(STACK, SQUARE, "own")];
    assert.equal(addInstrumentTrackGain(clip, STACK), clip);
    const noInstrument = [gain(TRACK, "own")];
    assert.equal(addInstrumentTrackGain(noInstrument, TRACK), noInstrument);
    const bypassed = [synth, { ...gain(TRACK, "own"), enabled: false }];
    assert.equal(addInstrumentTrackGain(bypassed, TRACK), bypassed);
  });
});

describe("clipMidiStack", () => {
  const trackSynth = createSynthEffect(TRACK, SQUARE, "track-synth");
  const trackArp = createArpeggiatorEffect(
    TRACK,
    DEFAULT_ARPEGGIATOR,
    "track-arp",
  );
  const ids = (stack: readonly { id: string }[]) =>
    stack.map((effect) => effect.id);

  it("is the track's stack for a clip with none", () => {
    assert.deepEqual(ids(clipMidiStack([], [trackArp, trackSynth])), [
      "track-arp",
      "track-synth",
    ]);
  });

  it("runs a clip's lone Arpeggiator ahead of the track's chain", () => {
    const own = createArpeggiatorEffect(STACK, DEFAULT_ARPEGGIATOR, "own");
    assert.deepEqual(ids(clipMidiStack([own], [trackArp, trackSynth])), [
      "own",
      "track-arp",
      "track-synth",
    ]);
  });

  it("is the clip's stack alone when it has an instrument, even a bypassed one", () => {
    const own = { ...createSynthEffect(STACK, SQUARE, "own"), enabled: false };
    assert.deepEqual(ids(clipMidiStack([own], [trackArp, trackSynth])), [
      "own",
    ]);
  });
});

describe("carryTrackInstrument", () => {
  const OTHER = sourceTrackEffectTrackId("to");
  const arp = createArpeggiatorEffect(TRACK, DEFAULT_ARPEGGIATOR, "arp");
  const synth = createSynthEffect(TRACK, SQUARE, "synth");

  it("copies the MIDI effects to a track with no instrument", () => {
    const own = gain(OTHER, "own");
    const next = carryTrackInstrument(
      [arp, synth, gain(TRACK, "audio"), own],
      "t",
      "to",
      () => "copy",
    );
    assert.deepEqual(
      next
        .filter((effect) => effect.trackId === OTHER)
        .map((effect) => [effect.id, effect.effectName]),
      [
        ["copy", arp.effectName],
        ["copy", synth.effectName],
        ["own", own.effectName],
      ],
    );
    assert.deepEqual(
      midiChainOf(next.filter((effect) => effect.trackId === OTHER))
        ?.instrument,
      asSynth(SQUARE),
    );
  });

  it("leaves a track that has an instrument, and an unchanged track, alone", () => {
    const effects = [synth, createSynthEffect(OTHER, DEFAULT_SYNTH_PARAMS)];
    assert.equal(carryTrackInstrument(effects, "t", "to"), effects);
    assert.equal(carryTrackInstrument(effects, "t", "t"), effects);
  });

  it("carries a moved MIDI clip's, and not a moved media clip's", () => {
    const effects = [synth];
    const before = [
      { id: "m", sourceTrackId: "t", notes: [] },
      { id: "v", sourceTrackId: "t" },
    ];
    const media = [before[0], { id: "v", sourceTrackId: "to" }];
    assert.equal(carryMovedClipInstruments(effects, before, media), effects);
    const moved = carryMovedClipInstruments(effects, before, [
      { id: "m", sourceTrackId: "to", notes: [] },
      before[1],
    ]);
    assert.deepEqual(
      moved
        .filter((effect) => effect.trackId === OTHER)
        .map((effect) => effect.effectName),
      [synth.effectName, GAIN_EFFECT_NAME],
    );
  });
});

describe("migrateMidiTrackEffects", () => {
  const clip = (id: string) => sourceClipEffectTrackId(id);
  const span = (id: string, startQ: number, sourceTrackId = "t") => ({
    id,
    startQ,
    sourceTrackId,
    notes: [],
  });
  const stacks = (effects: readonly SessionEffect[]) =>
    effects.map((effect) => [effect.id, effect.trackId]);

  it("leaves a session already saved with track effects as it is", () => {
    const effects = [createSynthEffect(clip("a"), SQUARE, "s")];
    assert.equal(
      migrateMidiTrackEffects(effects, [span("a", 0)], true),
      effects,
    );
  });

  it("moves a clip's MIDI effects to the track, its audio ones staying", () => {
    const next = migrateMidiTrackEffects(
      [
        gain(TRACK, "track-gain"),
        createSynthEffect(clip("a"), SQUARE, "s"),
        gain(clip("a"), "clip-gain"),
      ],
      [span("a", 0)],
      undefined,
    );
    assert.deepEqual(stacks(next), [
      ["s", TRACK],
      ["track-gain", TRACK],
      ["clip-gain", clip("a")],
    ]);
  });

  it("drops the same instrument from the track's other clips", () => {
    const next = migrateMidiTrackEffects(
      [
        createSynthEffect(clip("late"), SQUARE, "late"),
        createSynthEffect(clip("early"), SQUARE, "early"),
      ],
      [span("late", 8), span("early", 0)],
      undefined,
    );
    assert.deepEqual(stacks(next), [["early", TRACK]]);
  });

  it("leaves a clip playing something else its own, so it sounds as it did", () => {
    const next = migrateMidiTrackEffects(
      [
        createSynthEffect(clip("a"), SQUARE, "a"),
        createSynthEffect(clip("b"), DEFAULT_SYNTH_PARAMS, "b"),
      ],
      [span("a", 0), span("b", 8)],
      undefined,
    );
    assert.deepEqual(stacks(next), [
      ["b", clip("b")],
      ["a", TRACK],
    ]);
  });

  it("gives the track a Gain only when all its MIDI clips have one", () => {
    const names = (effects: readonly SessionEffect[]) =>
      effects
        .filter((effect) => effect.trackId === TRACK)
        .map((effect) => effect.effectName);
    const synth = createSynthEffect(clip("a"), SQUARE, "s");
    assert.deepEqual(
      names(
        migrateMidiTrackEffects(
          [synth, gain(clip("a"), "ga")],
          [span("a", 0)],
          undefined,
        ),
      ),
      [synth.effectName, GAIN_EFFECT_NAME],
    );
    // A clip that was silent for want of a Gain stays so.
    assert.deepEqual(
      names(
        migrateMidiTrackEffects(
          [synth, gain(clip("a"), "ga")],
          [span("a", 0), span("b", 8)],
          undefined,
        ),
      ),
      [synth.effectName],
    );
  });
});
