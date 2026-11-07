import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSynthEffect } from "../midi-effects.ts";
import { sourceClipEffectTrackId } from "../fx/stack/clip-stacks.ts";
import { createEffect } from "../fx/stack/ops.ts";
import {
  createDefaultModulation,
  type EffectModulation,
  getModulatableParameters,
  supportsModulation,
} from "../fx-modulation-defaults.ts";
import {
  DEFAULT_GRANULAR_PARAMS,
  DEFAULT_SYNTH_PARAMS,
  type MidiNote,
} from "../midi-clip.ts";
import { midiChainOf } from "../midi-effects.ts";
import { arpeggiate, DEFAULT_ARPEGGIATOR } from "../note-generators.ts";
import { granularGrains } from "./granular.ts";
import {
  clipModulator,
  type MidiModulation,
  noteOnsets,
  reactiveLevelAt,
} from "./midi-modulation.ts";
import { DEFAULT_TIME_SIGNATURE } from "./processor.ts";
import { resolveAudioClips } from "./resolve.ts";
import { synthMediaId, synthVoices } from "./synth.ts";

const STACK = sourceClipEffectTrackId("m");
const CLOCK = { offsetSeconds: 0, signature: DEFAULT_TIME_SIGNATURE };
const note = (start: number, length = 1, velocity = 127): MidiNote => ({
  pitch: 60,
  start,
  length,
  velocity,
});

// A free-running 1 Hz square LFO, so a knob is up for half a second then down.
function lfo(key: string, min: number, max: number, depth = 1): MidiModulation {
  return {
    mode: "lfo",
    seed: "effect",
    shape: "Square",
    sync: false,
    rate: 1,
    syncRate: "1/8",
    depth,
    phase: 0,
    parameters: [{ key, min, max }],
  };
}

function reactive(key: string, min: number, max: number): MidiModulation {
  return {
    mode: "transient",
    seed: "effect",
    motion: "Single",
    reactivity: 1,
    amplitude: 1,
    lengthFrames: 12,
    parameters: [{ key, min, max }],
  };
}

describe("MIDI effects' Modulation support", () => {
  it("is offered on the Synth, Granular and Arpeggiator, not the Drum Rack", () => {
    assert.equal(supportsModulation("Synth"), true);
    assert.equal(supportsModulation("Granular"), true);
    assert.equal(supportsModulation("Arpeggiator"), true);
    assert.equal(supportsModulation("Drum Rack"), false);
  });

  it("moves their knobs and the Arpeggiator's Rate", () => {
    const keys = (effectName: string) =>
      getModulatableParameters(effectName).map(({ key }) => key);
    assert.deepEqual(keys("Arpeggiator"), ["Rate", "Octaves"]);
    assert.ok(keys("Synth").includes("Cutoff"));
    assert.ok(!keys("Synth").includes("Wave"));
    assert.ok(keys("Granular").includes("Position"));
  });
});

describe("midiChainOf with Modulation", () => {
  const modulated = (enabled: boolean): EffectModulation => ({
    ...(createDefaultModulation("Synth") as EffectModulation),
    enabled,
    mode: "lfo",
  });
  const synth = (enabled: boolean) => ({
    ...createSynthEffect("stack", undefined, "synth-1"),
    modulation: modulated(enabled),
  });

  it("carries the instrument's Modulation while it is on", () => {
    const { instrument } = midiChainOf([synth(true)]) ?? {};
    assert.equal(instrument?.kind, "synth");
    assert.ok(instrument?.kind === "synth" && instrument.modulation);
    assert.equal(instrument.modulation.mode, "lfo");
    assert.equal(instrument.modulation.seed, "synth-1");
    assert.deepEqual(
      instrument.modulation.parameters.map(({ key }) => key),
      ["Cutoff"],
    );
  });

  it("leaves it out while it is off", () => {
    const { instrument } = midiChainOf([synth(false)]) ?? {};
    assert.deepEqual(instrument, {
      kind: "synth",
      params: instrument?.params,
    });
  });

  it("carries a stepped Rate over the indices of its options", () => {
    const modulation = createDefaultModulation(
      "Arpeggiator",
    ) as EffectModulation;
    const chain = midiChainOf([
      {
        ...createEffect("stack", "Arpeggiator", "arp"),
        modulation: {
          ...modulation,
          enabled: true,
          mode: "lfo",
          lfo: { ...modulation.lfo, parameters: ["Rate"] },
        },
      },
      createSynthEffect("stack", undefined, "synth"),
    ]);
    assert.deepEqual(chain?.generators[0].modulation?.parameters, [
      { key: "Rate", min: 0, max: 3 },
    ]);
  });
});

describe("noteOnsets", () => {
  it("gives a chord's notes one hit, its loudest, on session time", () => {
    assert.deepEqual(
      noteOnsets([note(1, 1, 127), note(0, 1, 50), note(0, 1, 100)], 60, 2),
      [
        { time: 2, strength: 100 / 127 },
        { time: 3, strength: 1 },
      ],
    );
  });
});

describe("clipModulator", () => {
  it("needs a modulation and a clock", () => {
    assert.equal(clipModulator(undefined, [], 60, CLOCK), undefined);
    assert.equal(
      clipModulator(lfo("Cutoff", 20, 20_000), [], 60, undefined),
      undefined,
    );
  });

  it("runs an LFO on session time, wherever the clip sits", () => {
    const modulation = lfo("Knob", 0, 1);
    const at = (offsetSeconds: number, seconds: number) =>
      clipModulator(modulation, [], 60, {
        ...CLOCK,
        offsetSeconds,
      })?.value("Knob", 0.5, seconds);
    assert.equal(at(0, 0.25), 0.75);
    assert.equal(at(0, 0.75), 0.25);
    // Half a cycle later on the session, the clip starts where it goes down.
    assert.equal(at(0.5, 0.25), 0.25);
  });

  it("leaves knobs it doesn't move as they are", () => {
    const modulator = clipModulator(lfo("Knob", 0, 1), [], 60, CLOCK);
    assert.equal(modulator?.moves("Other"), false);
    assert.equal(modulator?.value("Other", 0.5, 0.25), 0.5);
  });

  it("swings Reactive knobs on the notes' hits and settles between them", () => {
    const modulator = clipModulator(
      reactive("Knob", 0, 1),
      [note(1)],
      60,
      CLOCK,
    );
    assert.equal(modulator?.value("Knob", 0.5, 0.5), 0.5);
    assert.notEqual(modulator?.value("Knob", 0.5, 1.1), 0.5);
    assert.equal(modulator?.value("Knob", 0.5, 2), 0.5);
  });
});

describe("reactiveLevelAt", () => {
  it("reports the level and hit a chain would for an audio effect", () => {
    const settings = { motion: "Single", reactivity: 1, amplitude: 1 } as const;
    const onsets = [{ time: 1, strength: 1 }];
    assert.deepEqual(reactiveLevelAt(settings, 12, onsets, 0.5), {
      level: 0,
      hit: 0,
    });
    const { level, hit } = reactiveLevelAt(settings, 12, onsets, 1.1);
    assert.ok(level > 0);
    assert.equal(hit, 60);
  });
});

describe("synthVoices with Modulation", () => {
  const params = { ...DEFAULT_SYNTH_PARAMS, attack: 0, release: 0 };
  const voiceFor = (modulation: MidiModulation) =>
    synthVoices(
      [note(0, 2)],
      params,
      60,
      Number.POSITIVE_INFINITY,
      clipModulator(modulation, [note(0, 2)], 60, CLOCK),
    )[0];

  it("sweeps the Cutoff through a sounding note", () => {
    const { cutoff } = voiceFor(lfo("Cutoff", 20, 20_000));
    const near = (seconds: number) =>
      cutoff?.find((point) => point.seconds >= seconds)?.value as number;
    assert.ok(near(0.25) > params.cutoff);
    assert.ok(near(0.75) < params.cutoff);
    assert.ok(near(1.25) > params.cutoff);
  });

  it("sweeps Detune and Resonance only when they are selected", () => {
    const voice = voiceFor(lfo("Resonance", 0.0001, 30));
    assert.ok(voice.resonance?.length);
    assert.equal(voice.cutoff, undefined);
    assert.equal(voice.detune, undefined);
    assert.ok(voiceFor(lfo("Detune", -1200, 1200)).detune?.length);
  });

  it("keeps a note's timbre on top of a modulated Cutoff", () => {
    const bright: MidiNote = {
      ...note(0, 2),
      expression: {
        timbre: [{ at: 0, value: 1 }],
      },
    };
    const curveOf = (played: MidiNote) =>
      synthVoices(
        [played],
        params,
        60,
        Number.POSITIVE_INFINITY,
        clipModulator(lfo("Cutoff", 20, 20_000), [played], 60, CLOCK),
      )[0].cutoff?.[10].value as number;
    assert.ok(curveOf(bright) > curveOf(note(0, 2)));
  });

  it("takes each note's Octave from where the knob is as it starts", () => {
    const notes = [note(0.25, 0.1), note(0.75, 0.1)];
    const voices = synthVoices(
      notes,
      params,
      60,
      Number.POSITIVE_INFINITY,
      clipModulator(lfo("Octave", -3, 3, 4), notes, 60, CLOCK),
    );
    assert.equal(voices[0].frequency, voices[1].frequency * 2 ** 6);
  });
});

describe("granularGrains with Modulation", () => {
  const params = { ...DEFAULT_GRANULAR_PARAMS, spray: 0 };
  const grainsFor = (modulation: MidiModulation) =>
    granularGrains(
      [note(0, 4)],
      params,
      60,
      Number.POSITIVE_INFINITY,
      clipModulator(modulation, [note(0, 4)], 60, CLOCK),
    );

  it("reads each grain from where Position is as it starts", () => {
    const grains = grainsFor(lfo("Position", 0, 1));
    const offsetAt = (seconds: number) =>
      grains.find((grain) => grain.startSeconds >= seconds)?.offset as number;
    assert.ok(offsetAt(0.75) < offsetAt(0.25));
  });

  it("spaces grains as Density moves", () => {
    const grains = grainsFor(lfo("Density", 1, 100, 2));
    const gap = (seconds: number) => {
      const index = grains.findIndex(
        (grain) => grain.startSeconds >= seconds,
      );
      return grains[index + 1].startSeconds - grains[index].startSeconds;
    };
    assert.notEqual(gap(0.25).toFixed(4), gap(0.75).toFixed(4));
  });

  it("takes a cloud's Release from where the knob is as it starts", () => {
    const lastGrainEnd = (modulation: MidiModulation) =>
      Math.max(
        ...grainsFor(modulation).map(({ startSeconds }) => startSeconds),
      );
    const quiet = granularGrains([note(0, 4)], params, 60);
    assert.ok(
      lastGrainEnd(lfo("Release", 0, 10, 4)) >
        Math.max(...quiet.map(({ startSeconds }) => startSeconds)),
    );
  });
});

describe("arpeggiate with Modulation", () => {
  const held = [note(0, 4)];
  const clock = { ...CLOCK, bpm: 60 };
  // 1/4 at rest, its Rate up a step or more in the LFO's first half-cycle.
  const quarter = { ...DEFAULT_ARPEGGIATOR, rate: 1 as const };

  it("changes its Rate from step to step, on each rate's grid", () => {
    const played = arpeggiate(
      held,
      {
        ...quarter,
        rate: 0.5,
        modulation: lfo("Rate", 0, 3, 2),
      },
      0,
      clock,
    );
    const steps = played.map(({ start }) => start);
    assert.ok(steps.includes(0));
    for (const start of steps) {
      assert.equal(start % 0.125, 0, `${start} is off the grid`);
    }
    const gaps = steps.slice(1).map((start, index) => start - steps[index]);
    assert.ok(new Set(gaps).size > 1, "the Rate never moved");
    played.forEach(({ start, length }, index) => {
      if (index + 1 < played.length) {
        assert.ok(start + length <= played[index + 1].start + 1e-9);
      }
    });
  });

  it("widens its Octaves as they move", () => {
    const pitches = (modulation?: MidiModulation) =>
      new Set(
        arpeggiate(
          [note(0, 8)],
          { ...quarter, octaves: 2, ...(modulation ? { modulation } : {}) },
          0,
          clock,
        ).map(({ pitch }) => pitch),
      );
    assert.deepEqual([...pitches()].sort(), [60, 72]);
    assert.ok(pitches(lfo("Octaves", 1, 4, 4)).has(84));
  });

  it("ignores its modulation without a clock", () => {
    assert.deepEqual(
      arpeggiate(held, { ...quarter, modulation: lfo("Rate", 0, 3, 4) }),
      arpeggiate(held, quarter),
    );
  });
});

describe("a modulated MIDI clip in the mix", () => {
  const span = (startQ: number) => ({
    id: "m",
    sourceTrackId: "t",
    label: "",
    accent: "",
    startQ,
    trimStartSeconds: 0,
    durationSeconds: 4,
    notes: [note(0, 2)],
  });
  const clipOf = (startQ: number, enabled: boolean) => {
    const modulation = createDefaultModulation("Synth") as EffectModulation;
    const mix = resolveAudioClips({
      lanes: [],
      sourceTracks: [{ id: "t" }],
      clips: [],
      sourceSpans: [span(startQ)],
      mediaById: new Map(),
      effects: [
        {
          ...createSynthEffect(STACK, undefined, "synth"),
          modulation: { ...modulation, enabled, mode: "lfo" },
        },
      ],
      bpm: 60,
    } as never);
    return mix.clips[0];
  };

  it("renders anew when the clip moves, as its LFO's phase does", () => {
    const moved = clipOf(4, true);
    assert.equal(moved.synth?.modulationClock?.offsetSeconds, 4);
    assert.notEqual(clipOf(0, true).mediaId, moved.mediaId);
  });

  it("stays the same render when it is off, wherever the clip sits", () => {
    assert.equal(clipOf(0, false).synth?.modulationClock, undefined);
    assert.equal(clipOf(0, false).mediaId, clipOf(4, false).mediaId);
    assert.equal(
      clipOf(0, false).mediaId,
      synthMediaId(
        "m",
        {
          notes: [note(0, 2)],
          instrument: { kind: "synth", params: DEFAULT_SYNTH_PARAMS },
          durationSeconds: 4,
        },
        60,
      ),
    );
  });
});


