import { beforeAll, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { drumBankPadUrl, DRUM_BANKS } from "../../fx/effects/drum-rack/banks.ts";
import { auditionDrumPad, auditionNote } from "../../midi-audition.ts";
import {
  DEFAULT_GRANULAR_PARAMS,
  DEFAULT_SYNTH_PARAMS,
  type MidiInstrument,
} from "../../midi-clip.ts";

// An audition sounds as hard as its note's velocity (#1648), for every
// instrument: its level at a soft velocity is that much under its full one.
const SOFT = 32;
const FULL = 127;

// Reaches whatever gets to the speakers, as the voices come and go.
const analysers = new Map<BaseAudioContext, AnalyserNode>();

beforeAll(() => {
  const connect = AudioNode.prototype.connect;
  vi.spyOn(AudioNode.prototype, "connect").mockImplementation(function (
    this: AudioNode,
    ...args: unknown[]
  ) {
    if (args[0] instanceof AudioDestinationNode) {
      let analyser = analysers.get(this.context);
      if (!analyser) {
        analyser = this.context.createAnalyser();
        analyser.fftSize = 2048;
        analysers.set(this.context, analyser);
      }
      connect.call(this, analyser as never);
    }
    return connect.apply(this, args as Parameters<typeof connect>) as never;
  });
});

async function peakOf(play: () => void) {
  await userEvent.click(document.body);
  play();
  let peak = 0;
  const until = performance.now() + 400;
  while (performance.now() < until) {
    for (const analyser of analysers.values()) {
      const data = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(data);
      for (const value of data) {
        peak = Math.max(peak, Math.abs(value));
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  // Lets the voice's tail leave before the next one is measured.
  await new Promise((resolve) => setTimeout(resolve, 600));
  return peak;
}

function expectSofter(full: number, soft: number) {
  expect(full).toBeGreaterThan(0);
  expect(soft / full).toBeGreaterThan((SOFT / FULL) * 0.6);
  expect(soft / full).toBeLessThan((SOFT / FULL) * 1.6);
}

const INSTRUMENTS: [string, MidiInstrument][] = [
  ["Synth", { kind: "synth", params: DEFAULT_SYNTH_PARAMS }],
  ["Granular", { kind: "granular", params: DEFAULT_GRANULAR_PARAMS }],
];

test.each(INSTRUMENTS)(
  "%s sounds softer at a soft velocity",
  async (_, instrument) => {
    const play = (velocity: number) =>
      auditionNote(60, instrument, undefined, false, undefined, velocity);
    const full = await peakOf(() => play(FULL));
    const soft = await peakOf(() => play(SOFT));
    expectSofter(full, soft);
  },
);

test("a Drum Rack's pad sounds softer at a soft velocity", async () => {
  const params = {
    samples: DRUM_BANKS[0].pads.map((_, pad) =>
      drumBankPadUrl(DRUM_BANKS[0], pad),
    ),
  } as Parameters<typeof auditionDrumPad>[1];
  const play = (velocity: number) =>
    void auditionDrumPad(0, params, undefined, undefined, velocity);
  // The sample has loaded by the second hit, so both play at once.
  await peakOf(() => play(FULL));
  const full = await peakOf(() => play(FULL));
  const soft = await peakOf(() => play(SOFT));
  expectSofter(full, soft);
});

test("an audition with no velocity sounds as a full one", async () => {
  const instrument = INSTRUMENTS[0][1];
  const given = await peakOf(() =>
    auditionNote(60, instrument, undefined, false, undefined, FULL),
  );
  const unset = await peakOf(() => auditionNote(60, instrument));
  expect(unset / given).toBeGreaterThan(0.8);
  expect(unset / given).toBeLessThan(1.25);
});
