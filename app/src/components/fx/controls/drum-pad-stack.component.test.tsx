import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { CHAIN_WORKLET_URL } from "../../../audio-mix/chain-worklet-url.ts";
import {
  DRUM_RACK_EFFECT_NAME,
  DRUM_RACK_KEY,
} from "../../../fx/effects/drum-rack/drum-rack.ts";
import {
  GAIN_EFFECT_NAME,
  GAIN_KEY,
  MUTE_KEY,
} from "../../../fx/effects/gain/gain.ts";
import { MUTE_ON } from "../../../fx/effects/gain/processor.ts";
import {
  GLOBAL_EFFECT_TRACK_ID,
  sourceClipEffectTrackId,
  sourceTrackEffectTrackId,
} from "../../../fx/stack/clip-stacks.ts";
import { mapSessionEffectsToDevices } from "../../../fx/stack/devices.ts";
import { createEffect } from "../../../fx/stack/ops.ts";
import type { SessionEffect } from "../../../fx/stack/types.ts";
import { fireMappedButtons } from "../../../hooks/useKeyMap.ts";
import { setAuditionWorkletUrl } from "../../../midi-audition.ts";
import {
  type ArmedAuditionSession,
  setArmedAuditionSource,
} from "../../../recording/armed-audition.ts";
import { DrumRackControl } from "./DrumRackControl.tsx";

// A Drum Rack's pad sounds through the stacks of the clip the rack is on, as
// a key on its track does, whether pressed in the panel or by a mapped key,
// and dry on a rack no source track owns (#1634).
const TRACK = "track";
const CLIP = "clip";
const clipStack = sourceClipEffectTrackId(CLIP);
const trackStack = sourceTrackEffectTrackId(TRACK);
const rack = createEffect(clipStack, DRUM_RACK_EFFECT_NAME, "rack");
const trackRack = createEffect(trackStack, DRUM_RACK_EFFECT_NAME, "rack");

const gain = (stackId: string, db: number, mute = false): SessionEffect => {
  const effect = createEffect(stackId, GAIN_EFFECT_NAME);
  return {
    ...effect,
    parameters: effect.parameters.map((parameter) => {
      if (parameter.key === GAIN_KEY) {
        return { ...parameter, value: String(db), numericValue: db };
      }
      return parameter.key === MUTE_KEY && mute
        ? { ...parameter, value: MUTE_ON, numericValue: 1 }
        : parameter;
    }),
  };
};

// What the audition plays from: `effects` beside the rack, on the clip `CLIP`
// of the track `TRACK`, unless `owned` is false and the rack's clip is gone. The
// rack is on the clip's stack, or on `onStack`.
const session = (effects: SessionEffect[], owned = true, onStack = rack) => {
  setArmedAuditionSource(
    {
      clips: [],
      lanes: [],
      mediaItems: [],
      sourceTracks: [{ id: TRACK }],
      sourceSpans: owned
        ? [{ id: CLIP, sourceTrackId: TRACK, startQ: 0, notes: [] }]
        : [],
      effects: [onStack, ...effects],
      bpm: 120,
      signatureId: "4/4",
    } as unknown as ArmedAuditionSession,
    () => 8,
  );
};

// Tees what reaches the audition context's speakers into an analyser, from
// before the first test, as a track's chain connects to them once.
let level: () => number;
let contextState: () => AudioContextState | undefined;
beforeAll(() => {
  const connect = AudioNode.prototype.connect;
  let analyser: AnalyserNode | undefined;
  vi.spyOn(AudioNode.prototype, "connect").mockImplementation(function (
    this: AudioNode,
    ...args: unknown[]
  ) {
    if (args[0] instanceof AudioDestinationNode) {
      if (analyser?.context !== this.context) {
        analyser = this.context.createAnalyser();
        analyser.fftSize = 2048;
      }
      connect.call(this, analyser as never);
    }
    return connect.apply(this, args as Parameters<typeof connect>) as never;
  });
  level = () => {
    const data = new Float32Array(analyser?.fftSize ?? 0);
    analyser?.getFloatTimeDomainData(data);
    return data.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);
  };
  contextState = () => analyser?.context.state;
});

afterAll(() => {
  vi.restoreAllMocks();
});

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// The analyser's window, which shows the last of a context that has suspended
// until it has run through once more.
const WINDOW_MS = 60;

// The loudest a hit gets over its first moments, once what came before it has
// died away. The kick's sample is long enough to read at this rate.
async function peakOf(hit: () => unknown) {
  await expect
    .poll(() => contextState() !== "running" || level() < 0.0005, {
      timeout: 5000,
    })
    .toBe(true);
  await hit();
  await expect.poll(contextState, { timeout: 5000 }).toBe("running");
  await wait(WINDOW_MS);
  let peak = 0;
  for (let step = 0; step < 40; step++) {
    await wait(25);
    peak = Math.max(peak, level());
  }
  return peak;
}

const pressMappedKey = () =>
  fireMappedButtons(
    [{ kind: "pad", effectId: rack.id, parameter: DRUM_RACK_KEY, pad: 0 }],
    [rack],
    () => {},
  );

async function panelPad() {
  const [device] = mapSessionEffectsToDevices([rack], rack.trackId);
  const parameter = device.parameters.find(({ key }) => key === DRUM_RACK_KEY);
  if (!parameter) {
    throw new Error("No pads on the rack");
  }
  await render(
    <DrumRackControl
      device={device}
      layers={[]}
      onSetParameter={() => {}}
      parameter={parameter}
    />,
  );
  const pad = page.getByRole("button", { name: /^Pad 1:/ });
  return () => userEvent.click(pad);
}

beforeEach(async () => {
  setAuditionWorkletUrl(CHAIN_WORKLET_URL);
  // An AudioContext starts once the page has had a gesture.
  await userEvent.click(document.body);
});

test("a pad pressed in the panel sounds through its clip's, track's and Global stacks", {
  timeout: 60_000,
}, async () => {
  const press = await panelPad();
  session([gain(trackStack, 0)]);
  const unity = await peakOf(press);
  expect(unity).toBeGreaterThan(0.01);

  for (const quieter of [
    [gain(clipStack, -24)],
    [gain(trackStack, -24)],
    [gain(trackStack, 0), gain(GLOBAL_EFFECT_TRACK_ID, -24)],
  ]) {
    session(quieter);
    const peak = await peakOf(press);
    expect(peak).toBeLessThan(unity / 4);
    expect(peak).toBeGreaterThan(0);
  }
});

test("a pad fired from a key map sounds through its track's stack", {
  timeout: 60_000,
}, async () => {
  session([gain(trackStack, 0)]);
  const unity = await peakOf(pressMappedKey);
  expect(unity).toBeGreaterThan(0.01);

  session([gain(trackStack, -24)]);
  expect(await peakOf(pressMappedKey)).toBeLessThan(unity / 4);

  session([gain(trackStack, 0, true)]);
  expect(await peakOf(pressMappedKey)).toBeLessThan(0.001);
});

test("a pad on a track's Drum Rack sounds through the track's and Global stacks", {
  timeout: 60_000,
}, async () => {
  const press = await panelPad();
  session([gain(trackStack, 0)], true, trackRack);
  const unity = await peakOf(press);
  expect(unity).toBeGreaterThan(0.01);

  session([gain(trackStack, -24)], true, trackRack);
  expect(await peakOf(press)).toBeLessThan(unity / 4);

  session(
    [gain(trackStack, 0), gain(GLOBAL_EFFECT_TRACK_ID, 0, true)],
    true,
    trackRack,
  );
  expect(await peakOf(press)).toBeLessThan(0.001);
});

test("a Drum Rack no source track owns still plays, dry", {
  timeout: 60_000,
}, async () => {
  const press = await panelPad();
  // None of these stacks is the rack's to play through, not even Global's.
  const muted = [gain(GLOBAL_EFFECT_TRACK_ID, 0, true)];
  session(muted, false);
  expect(await peakOf(press)).toBeGreaterThan(0.01);
  expect(await peakOf(pressMappedKey)).toBeGreaterThan(0.01);
});
