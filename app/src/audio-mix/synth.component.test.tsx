import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { DRUM_RACK_EFFECT_NAME } from "../fx/effects/drum-rack/drum-rack.ts";
import { GRANULAR_EFFECT_NAME } from "../fx/effects/granular/granular.ts";
import { createEffect, setEffectParameter } from "../fx/stack/ops.ts";
import type { SessionEffect } from "../fx/stack/types.ts";
import { sourceClipEffectTrackId } from "../fx-stack.ts";
import {
  DEFAULT_SYNTH_PARAMS,
  type MidiNote,
  type SynthParams,
} from "../midi-clip.ts";
import { createArpeggiatorEffect, createSynthEffect } from "../midi-effects.ts";
import { DEFAULT_ARPEGGIATOR, type NoteGenerator } from "../note-generators.ts";
import { renderAudioMixOffline } from "./offline.ts";
import { type AudioMixPlayback, PreviewAudioMixer } from "./preview-mixer.ts";
import { resolveAudioClips } from "./resolve.ts";

// A MIDI clip plays its notes through its Synth effect, rendered by Web
// Audio voices in an OfflineAudioContext (see synth.ts): export mixes that
// performance in, and the preview plays it in time with the transport.

const SAMPLE_RATE = 48_000;
const BPM = 120;

// One quarter note is half a second. The clip starts at 1 s and plays two
// notes, at 1 s and at 3 s, each half a second long.
const NOTES: MidiNote[] = [
  { pitch: 69, start: 0, length: 1, velocity: 127 },
  { pitch: 72, start: 4, length: 1, velocity: 127 },
];

const stackId = sourceClipEffectTrackId("midi");

function midiMix(
  notes = NOTES,
  synth?: SynthParams,
  noteGenerators?: NoteGenerator[],
  instrument: SessionEffect = createSynthEffect(stackId, synth),
) {
  return resolveAudioClips({
    clips: [],
    lanes: [],
    sourceTracks: [{ id: "keys" }],
    sourceSpans: [
      {
        id: "midi",
        sourceTrackId: "keys",
        startQ: 2,
        durationSeconds: 4,
        trimStartSeconds: 0,
        notes,
      },
    ],
    mediaById: new Map(),
    // The clip's own stack: its Arpeggiators, its instrument, then its Gain.
    effects: [
      ...(noteGenerators ?? []).map((arp) =>
        createArpeggiatorEffect(stackId, arp),
      ),
      instrument,
      createEffect(stackId, "Gain", "gain"),
    ],
    bpm: BPM,
  });
}

async function render(
  notes = NOTES,
  synth?: SynthParams,
  noteGenerators?: NoteGenerator[],
  instrument?: SessionEffect,
) {
  const channels = await renderAudioMixOffline(
    midiMix(notes, synth, noteGenerators, instrument),
    [],
    {
      sampleRate: SAMPLE_RATE,
      numberOfChannels: 2,
      startSeconds: 0,
      length: 6 * SAMPLE_RATE,
    },
  );
  if (!channels) {
    throw new Error("The MIDI clip rendered nothing");
  }
  return channels[0];
}

// The loudest sample from `from` to `to` seconds.
function peak(samples: Float32Array, from: number, to: number) {
  let loudest = 0;
  for (
    let index = Math.floor(from * SAMPLE_RATE);
    index < Math.min(samples.length, to * SAMPLE_RATE);
    index++
  ) {
    loudest = Math.max(loudest, Math.abs(samples[index]));
  }
  return loudest;
}

test("export renders a MIDI clip's notes, and silence around them", async () => {
  const samples = await render();
  // Before the clip.
  expect(peak(samples, 0, 0.99)).toBe(0);
  // Each note, held.
  expect(peak(samples, 1.05, 1.45)).toBeGreaterThan(0.05);
  expect(peak(samples, 3.05, 3.45)).toBeGreaterThan(0.05);
  // Between the notes, once the first has been released, and after both.
  expect(peak(samples, 1.75, 2.99)).toBeLessThan(1e-4);
  expect(peak(samples, 3.75, 6)).toBeLessThan(1e-4);
});

test("export follows edits to the notes and to the synth", async () => {
  const samples = await render();
  // A note moved a beat later.
  const moved = await render([NOTES[0], { ...NOTES[1], start: 5 }]);
  expect(peak(moved, 3.05, 3.45)).toBeLessThan(1e-4);
  expect(peak(moved, 3.55, 3.95)).toBeGreaterThan(0.05);
  // A quieter note.
  const quiet = await render([{ ...NOTES[0], velocity: 32 }, NOTES[1]]);
  expect(peak(quiet, 1.05, 1.45)).toBeLessThan(peak(samples, 1.05, 1.45) / 2);
  // A longer release rings on past the note.
  const ringing = await render(NOTES, {
    ...DEFAULT_SYNTH_PARAMS,
    release: 1,
  });
  expect(peak(ringing, 1.75, 1.9)).toBeGreaterThan(0.01);
  // Another wave through a lower cutoff sounds different.
  const filtered = await render(NOTES, {
    ...DEFAULT_SYNTH_PARAMS,
    wave: "square",
    cutoff: 300,
  });
  let difference = 0;
  for (let index = 0; index < samples.length; index++) {
    difference = Math.max(
      difference,
      Math.abs(samples[index] - filtered[index]),
    );
  }
  expect(difference).toBeGreaterThan(0.05);
});

// How many times the signal crosses zero from `from` to `to` seconds, which
// grows with the pitch it plays.
function zeroCrossings(samples: Float32Array, from: number, to: number) {
  let crossings = 0;
  for (
    let index = Math.floor(from * SAMPLE_RATE) + 1;
    index < to * SAMPLE_RATE;
    index++
  ) {
    if (samples[index - 1] < 0 !== samples[index] < 0) {
      crossings++;
    }
  }
  return crossings;
}

test("export renders an arpeggiated performance at the arpeggiator's rate", async () => {
  // Middle C held for the clip's four seconds, through a sine, arpeggiated
  // in eighths (a quarter of a second) up two octaves: it alternates
  // between middle C and the C above on every step from 1 s.
  const held: MidiNote[] = [{ pitch: 60, start: 0, length: 8, velocity: 127 }];
  const sine = { ...DEFAULT_SYNTH_PARAMS, wave: "sine" as const };
  const arp = {
    ...DEFAULT_ARPEGGIATOR,
    rate: 0.5 as const,
    octaves: 2,
  };
  const samples = await render(held, sine, [arp]);
  const stepPitches = Array.from({ length: 16 }, (_, step) => {
    const start = 1 + step * 0.25;
    // Each step sounds, its onset on the step.
    expect(peak(samples, start + 0.02, start + 0.2)).toBeGreaterThan(0.05);
    return zeroCrossings(samples, start + 0.03, start + 0.22);
  });
  for (const [step, crossings] of stepPitches.entries()) {
    // About 100 crossings for middle C in the window, 200 an octave up.
    if (step % 2) {
      expect(crossings).toBeGreaterThan(180);
    } else {
      expect(crossings).toBeGreaterThan(85);
      expect(crossings).toBeLessThan(115);
    }
  }
  expect(peak(samples, 5.25, 6)).toBeLessThan(1e-4);

  // Bypassed, it plays the held note at one pitch throughout.
  const bypassed = await render(held, sine, [{ ...arp, enabled: false }]);
  for (let step = 0; step < 16; step++) {
    const start = 1 + step * 0.25;
    const crossings = zeroCrossings(bypassed, start + 0.03, start + 0.22);
    expect(crossings).toBeGreaterThan(85);
    expect(crossings).toBeLessThan(115);
  }
});

test("export plays a MIDI clip through its Granular as grain clouds, the same every time", async () => {
  const granular = createEffect(stackId, GRANULAR_EFFECT_NAME);
  const held: MidiNote[] = [
    { pitch: 60, start: 0, length: 2, velocity: 127 },
    { pitch: 72, start: 4, length: 2, velocity: 127 },
  ];
  const samples = await render(held, undefined, undefined, granular);
  expect(peak(samples, 0, 0.99)).toBe(0);
  // Each note sounds while held, and the cloud is gone once it is released.
  expect(peak(samples, 1.05, 1.95)).toBeGreaterThan(0.02);
  expect(peak(samples, 3.05, 3.95)).toBeGreaterThan(0.02);
  expect(peak(samples, 2.6, 2.99)).toBeLessThan(1e-4);
  expect(peak(samples, 4.6, 6)).toBeLessThan(1e-4);
  // The octave above reads the source twice as fast.
  const low = zeroCrossings(samples, 1.2, 1.8);
  const high = zeroCrossings(samples, 3.2, 3.8);
  expect(high / low).toBeGreaterThan(1.6);
  expect(high / low).toBeLessThan(2.4);
  // The same notes render the same samples again.
  const again = await render(held, undefined, undefined, granular);
  expect(again).toEqual(samples);
  // A sparser cloud of longer grains sounds different.
  const sparse = await render(
    held,
    undefined,
    undefined,
    setEffectParameter(
      setEffectParameter([granular], granular.id, "Density", 4),
      granular.id,
      "Grain Size",
      0.3,
    )[0],
  );
  let difference = 0;
  for (let index = 0; index < samples.length; index++) {
    difference = Math.max(difference, Math.abs(samples[index] - sparse[index]));
  }
  expect(difference).toBeGreaterThan(0.01);
});

test("export plays a MIDI clip through its Drum Rack, fetching only the pads it hits", async () => {
  const fetched: string[] = [];
  const fetchBefore = window.fetch;
  window.fetch = (input, init) => {
    fetched.push(String(input instanceof Request ? input.url : input));
    return fetchBefore(input, init);
  };
  try {
    const rack = createEffect(stackId, DRUM_RACK_EFFECT_NAME);
    // A kick (pad 1) at 1 s and a clap (pad 4) at 3 s, the second off the
    // pads (note 60) at 2 s.
    const hits: MidiNote[] = [
      { pitch: 36, start: 0, length: 0.25, velocity: 127 },
      { pitch: 60, start: 2, length: 0.25, velocity: 127 },
      { pitch: 39, start: 4, length: 0.25, velocity: 64 },
    ];
    const samples = await render(hits, undefined, undefined, rack);
    expect(peak(samples, 0, 0.99)).toBe(0);
    expect(peak(samples, 1, 1.2)).toBeGreaterThan(0.1);
    // The kick has died away before the note off the pads, which is silent.
    expect(peak(samples, 2.6, 2.99)).toBeLessThan(1e-3);
    expect(peak(samples, 3, 3.2)).toBeGreaterThan(0.02);
    // Only the two pads it plays were fetched, from the 808 bank.
    const banks = fetched.filter((url) => url.includes("/drum-banks/"));
    expect(
      banks.map((url) => url.replace(/^.*\/drum-banks\//, "")).sort(),
    ).toEqual(["tr-808/01-kick.wav", "tr-808/04-clap.wav"]);
    // The same notes render the same samples again.
    const again = await render(hits, undefined, undefined, rack);
    expect(again).toEqual(samples);
  } finally {
    window.fetch = fetchBefore;
  }
});

// Hears the mix: the loudest sample since it was last asked.
const PEAK_TAP = `registerProcessor("peak-tap", class extends AudioWorkletProcessor {
  peak = 0;
  constructor() {
    super();
    this.port.onmessage = () => {
      this.port.postMessage(this.peak);
      this.peak = 0;
    };
  }
  process([input]) {
    for (const sample of input[0] ?? []) {
      this.peak = Math.max(this.peak, Math.abs(sample));
    }
    return true;
  }
});`;

function playback(playheadSeconds: number, isPlaying: boolean) {
  return {
    playheadSeconds,
    isPlaying,
    isScrubbing: false,
    isAudibleScrubbing: false,
    isContinuousScrubbing: false,
  } satisfies AudioMixPlayback;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("the preview plays a MIDI clip in time through seeks and loops", {
  timeout: 30_000,
}, async () => {
  // A click lets the mixer's AudioContext start.
  await userEvent.click(document.body);
  // Notes held long enough to hear past the mixer's catching up: one from
  // 1 s to 2.5 s and one from 4 s to the clip's end at 5 s, with silence
  // between them from 2.7 s.
  const mixer = new PreviewAudioMixer();
  mixer.update(
    midiMix([
      { pitch: 69, start: 0, length: 3, velocity: 127 },
      { pitch: 72, start: 6, length: 3, velocity: 127 },
    ]),
    [],
  );
  // Parked under the first note, the voice renders its clip.
  mixer.sync(playback(1.2, false));
  const analyser = mixer.analyser;
  if (!analyser) {
    throw new Error("The mixer made no graph");
  }
  const context = analyser.context as AudioContext;
  await context.audioWorklet.addModule(
    URL.createObjectURL(new Blob([PEAK_TAP], { type: "text/javascript" })),
  );
  const node = new AudioWorkletNode(context, "peak-tap");
  analyser.connect(node);
  await context.resume();
  for (let sync = 0; sync < 40; sync++) {
    mixer.sync(playback(1.2, false));
    await wait(25);
  }
  const heard = () =>
    new Promise<number>((resolve) => {
      node.port.onmessage = (event) => resolve(event.data);
      node.port.postMessage("read");
    });
  // Plays from `from` for `seconds` on the wall clock, as the transport
  // does, and returns the loudest sample heard after the first 150 ms.
  const play = async (from: number, seconds: number) => {
    const startedAt = performance.now();
    let settled = false;
    for (;;) {
      const elapsed = (performance.now() - startedAt) / 1000;
      if (elapsed >= seconds) {
        break;
      }
      if (!settled && elapsed >= 0.15) {
        settled = true;
        await heard();
      }
      mixer.sync(playback(from + elapsed, true));
      await wait(20);
    }
    return heard();
  };

  // Paused, it is silent.
  await heard();
  await wait(200);
  expect(await heard()).toBeLessThan(1e-3);
  // Playing under the first note.
  expect(await play(1.2, 0.6)).toBeGreaterThan(0.05);
  // Seeking into the silence between the notes.
  expect(await play(2.9, 0.6)).toBeLessThan(1e-3);
  // Seeking under the second note.
  expect(await play(4.2, 0.6)).toBeGreaterThan(0.05);
  // Looping back from the silence after both notes to the first.
  expect(await play(5.8, 0.4)).toBeLessThan(1e-3);
  expect(await play(1.3, 0.6)).toBeGreaterThan(0.05);
  mixer.pause();
  mixer.dispose();
});
