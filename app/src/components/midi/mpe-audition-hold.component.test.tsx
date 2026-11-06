import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { AuditionVoice } from "../../midi-audition.ts";
import {
  DEFAULT_GRANULAR_PARAMS,
  DEFAULT_INSTRUMENT,
  DEFAULT_SYNTH_PARAMS,
  type MidiInstrument,
} from "../../midi-clip.ts";
import { defaultMidiTimeline } from "../../midi-clip-timeline.ts";
import {
  createMidiInputHub,
  type MidiInputPort,
} from "../../midi-input/input-hub.ts";
import { PianoRoll } from "./PianoRoll";

// Holding an audition while a key is down on a device playing MPE (#1567),
// through a simulated device: first the voices the roll asks for, then what
// the real voices sound like. A device with no configuration message is first
// shown to play MPE by its second member channel (#1575).

const TIMEOUT = { timeout: 8000 };

type Auditioning = NonNullable<Parameters<typeof PianoRoll>[0]["onAudition"]>;

async function renderRoll({
  instrument = DEFAULT_INSTRUMENT,
  onAudition,
}: {
  instrument?: MidiInstrument;
  onAudition?: Auditioning;
}) {
  const port: MidiInputPort = {
    id: "Test MPE",
    name: "Test MPE",
    state: "connected",
    onmidimessage: null,
  };
  const access = {
    inputs: new Map([[port.id, port]]),
    onstatechange: null as (() => void) | null,
  };
  const hub = createMidiInputHub({
    requestAccess: async () => access,
    loadMappings: async () => [],
    storage: {
      getItem: () => JSON.stringify({ enabled: true }),
      setItem: () => {},
    },
  });
  const roll = (collapsed: boolean) => (
    <PianoRoll
      collapsed={collapsed}
      midiHub={hub}
      model={{
        spanId: "clip",
        label: "Bassline",
        accent: "#7ca1ff",
        notes: [],
        startQ: 0,
        trimStartQ: 0,
        lengthQ: 8,
        timeline: defaultMidiTimeline(8),
        instrument,
      }}
      {...(onAudition ? { onAudition } : {})}
      onSetNotes={() => {}}
      onSetTimeline={() => {}}
      onToggleCollapsed={() => {}}
    />
  );
  const screen = await render(roll(false));
  await vi.waitFor(() => expect(port.onmidimessage).not.toBeNull());
  const send = (...bytes: number[]) =>
    port.onmidimessage?.({ data: new Uint8Array(bytes) });
  return {
    send,
    configureMpe() {
      send(0xb0, 101, 0);
      send(0xb0, 100, 6);
      send(0xb0, 6, 15);
    },
    disconnect() {
      port.state = "disconnected";
      access.onstatechange?.();
    },
    collapse: () => screen.rerender(roll(true)),
    unmount: () => screen.unmount(),
  };
}

// Records what the roll asks to audition, and which voices it has released.
function listeningVoices() {
  const holds: (boolean | undefined)[] = [];
  const held: number[] = [];
  const released: number[] = [];
  const onAudition: Auditioning = (pitch, _, __, hold) => {
    holds.push(hold);
    const voice: AuditionVoice = {
      update() {},
      hold: () => held.push(pitch),
      release: () => released.push(pitch),
    };
    return voice;
  };
  return { holds, held, released, onAudition };
}

test("an MPE key holds its voice until the key comes up", async () => {
  const { holds, released, onAudition } = listeningVoices();
  const roll = await renderRoll({ onAudition });
  roll.configureMpe();
  roll.send(0x91, 60, 100);
  roll.send(0x92, 64, 100);
  expect(holds).toEqual([true, true]);
  roll.send(0x81, 60, 0);
  expect(released).toEqual([60]);
  roll.send(0x82, 64, 0);
  expect(released).toEqual([60, 64]);
  roll.unmount();
  expect(released).toEqual([60, 64]);
});

test("pressing a key again releases the voice it was holding", async () => {
  const { released, onAudition } = listeningVoices();
  const roll = await renderRoll({ onAudition });
  roll.configureMpe();
  roll.send(0x91, 60, 100);
  roll.send(0x91, 60, 100);
  expect(released).toEqual([60]);
  roll.unmount();
  expect(released).toEqual([60, 60]);
});

test("a device going away releases the voices it was holding", async () => {
  const { released, onAudition } = listeningVoices();
  const roll = await renderRoll({ onAudition });
  roll.configureMpe();
  roll.send(0x91, 60, 100);
  roll.send(0x92, 64, 100);
  roll.disconnect();
  await expect.poll(() => released).toEqual([60, 64]);
  roll.unmount();
  expect(released).toEqual([60, 64]);
});

test("the roll collapsing releases the voices it was holding", async () => {
  const { released, onAudition } = listeningVoices();
  const roll = await renderRoll({ onAudition });
  roll.configureMpe();
  roll.send(0x91, 60, 100);
  await roll.collapse();
  expect(released).toEqual([60]);
  roll.unmount();
});

test("the roll closing releases the voices it was holding", async () => {
  const { released, onAudition } = listeningVoices();
  const roll = await renderRoll({ onAudition });
  roll.configureMpe();
  roll.send(0x91, 60, 100);
  roll.unmount();
  expect(released).toEqual([60]);
});

test("clicks and keys from a device not playing MPE don't hold", async () => {
  const { holds, onAudition } = listeningVoices();
  const roll = await renderRoll({ onAudition });
  roll.send(0x90, 60, 100);
  roll.send(0x80, 60, 0);
  document.querySelector<HTMLElement>("[aria-label='Play C4']")?.click();
  expect(holds).toEqual([undefined, undefined]);
  roll.unmount();
});

test("a key already down holds once its device is shown to play MPE", async () => {
  const { holds, held, released, onAudition } = listeningVoices();
  const roll = await renderRoll({ onAudition });
  roll.send(0x91, 60, 100);
  expect(holds).toEqual([undefined]);
  expect(held).toEqual([]);
  roll.send(0x92, 64, 100);
  expect(holds).toEqual([undefined, true]);
  expect(held).toEqual([60]);
  roll.send(0x81, 60, 0);
  expect(released).toEqual([60]);
  roll.send(0x82, 64, 0);
  expect(released).toEqual([60, 64]);
  roll.unmount();
});

test("a key that came up before the device was shown stays as it is", async () => {
  const { held, onAudition } = listeningVoices();
  const roll = await renderRoll({ onAudition });
  roll.send(0x91, 60, 100);
  roll.send(0x81, 60, 0);
  roll.send(0x92, 64, 100);
  expect(held).toEqual([]);
  roll.unmount();
});

test("a configuration message holds the keys already down", async () => {
  const { held, onAudition } = listeningVoices();
  const roll = await renderRoll({ onAudition });
  roll.send(0x90, 60, 100);
  expect(held).toEqual([]);
  roll.configureMpe();
  expect(held).toEqual([60]);
  roll.unmount();
});

test("a key's expression reaches it once its device is shown to play MPE", async () => {
  const samples: unknown[] = [];
  const onAudition: Auditioning = () => ({
    update: (sample) => samples.push(sample),
    hold() {},
    release() {},
  });
  const roll = await renderRoll({ onAudition });
  roll.send(0x91, 60, 100);
  roll.send(0xb1, 74, 127);
  expect(samples).toEqual([]);
  roll.send(0x92, 64, 100);
  expect(samples).toContainEqual({ bend: 0, timbre: 1 });
  roll.unmount();
});

test("a keyboard that never counts as MPE doesn't hold", async () => {
  const { holds, held, onAudition } = listeningVoices();
  const roll = await renderRoll({ onAudition });
  // Keys on the first channel, and a pad on the tenth.
  roll.send(0x90, 60, 100);
  roll.send(0x90, 64, 100);
  roll.send(0x99, 36, 100);
  expect(holds).toEqual([undefined, undefined, undefined]);
  expect(held).toEqual([]);
  roll.unmount();
});

test("a device going away releases a key that started holding", async () => {
  const { released, onAudition } = listeningVoices();
  const roll = await renderRoll({ onAudition });
  roll.send(0x91, 60, 100);
  roll.send(0x92, 64, 100);
  roll.disconnect();
  await expect.poll(() => released).toEqual([60, 64]);
  roll.unmount();
});

test("the roll closing releases a key that started holding", async () => {
  const { released, onAudition } = listeningVoices();
  const roll = await renderRoll({ onAudition });
  roll.send(0x91, 60, 100);
  roll.send(0x92, 64, 100);
  roll.unmount();
  expect(released).toEqual([60, 64]);
});

// Tees whatever reaches a context's destination into an analyser of its own,
// which stays connected, so it reads silence after the voices have gone. A
// context suspended once nothing is sounding keeps its last samples, so that
// counts as silent whatever they say.
function listenToAuditions() {
  const connect = AudioNode.prototype.connect;
  let tap: { context: BaseAudioContext; analyser: AnalyserNode } | undefined;
  vi.spyOn(AudioNode.prototype, "connect").mockImplementation(function (
    this: AudioNode,
    ...args: unknown[]
  ) {
    const [destination] = args;
    if (destination instanceof AudioDestinationNode) {
      if (tap?.context !== this.context) {
        const analyser = this.context.createAnalyser();
        analyser.fftSize = 2048;
        const idle = this.context.createConstantSource();
        idle.offset.value = 0;
        idle.connect(analyser);
        idle.start();
        tap = { context: this.context, analyser };
      }
      connect.call(this, tap.analyser as never);
    }
    return connect.apply(this, args as Parameters<typeof connect>) as never;
  });
  const samples = () => {
    const data = new Float32Array(tap?.analyser.fftSize ?? 0);
    tap?.analyser.getFloatTimeDomainData(data);
    return data;
  };
  const level = () =>
    tap?.context.state === "running"
      ? samples().reduce((peak, value) => Math.max(peak, Math.abs(value)), 0)
      : 0;
  // How sharply it turns for its size: higher for a higher or brighter sound.
  const brightness = () => {
    const data = samples();
    let turned = 0;
    let size = 0;
    for (let index = 2; index < data.length; index++) {
      turned += (data[index] - 2 * data[index - 1] + data[index - 2]) ** 2;
      size += data[index] ** 2;
    }
    return Math.sqrt(turned / Math.max(size, 1e-12));
  };
  return { level, brightness };
}

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
// Longer than a fixed audition of either instrument takes to fade away.
const PAST_A_FIXED_AUDITION_MS = 1100;
const SOUNDING = 0.001;
// A release long enough to tell from the voice just stopping.
const RELEASE = 2;

const INSTRUMENTS: [string, MidiInstrument, MidiInstrument][] = [
  [
    "Synth",
    { kind: "synth", params: DEFAULT_SYNTH_PARAMS },
    { kind: "synth", params: { ...DEFAULT_SYNTH_PARAMS, release: RELEASE } },
  ],
  [
    "Granular",
    { kind: "granular", params: DEFAULT_GRANULAR_PARAMS },
    {
      kind: "granular",
      params: { ...DEFAULT_GRANULAR_PARAMS, release: RELEASE },
    },
  ],
];

beforeEach(async () => {
  // An AudioContext starts once the page has had a gesture.
  await userEvent.click(document.body);
});

afterEach(() => {
  vi.restoreAllMocks();
});

test.each(INSTRUMENTS)(
  "a held MPE key keeps sounding through %s, and its expression stays audible",
  async (_, instrument) => {
    const { level, brightness } = listenToAuditions();
    const roll = await renderRoll({ instrument });
    roll.configureMpe();
    roll.send(0x91, 60, 100);
    await wait(PAST_A_FIXED_AUDITION_MS);
    expect(level()).toBeGreaterThan(SOUNDING);

    const before = brightness();
    roll.send(0xe1, 0x7f, 0x7f);
    await expect.poll(brightness, TIMEOUT).toBeGreaterThan(before * 1.5);
    roll.send(0xe1, 0, 0x40);
    await wait(100);

    const open = brightness();
    roll.send(0xb1, 74, 0);
    await expect.poll(brightness, TIMEOUT).toBeLessThan(open * 0.8);

    const full = level();
    roll.send(0xd1, 0);
    await expect.poll(level, TIMEOUT).toBeLessThan(full * 0.6);
    expect(level()).toBeGreaterThan(SOUNDING);

    roll.send(0x81, 60, 0);
    await expect.poll(level, TIMEOUT).toBeLessThan(SOUNDING);
    roll.unmount();
  },
  30_000,
);

test.each(INSTRUMENTS)(
  "a released MPE key fades through the release of %s",
  async (_, __, instrument) => {
    const { level } = listenToAuditions();
    const roll = await renderRoll({ instrument });
    roll.configureMpe();
    roll.send(0x91, 60, 100);
    await wait(100);
    roll.send(0x81, 60, 0);
    await wait(500);
    expect(level()).toBeGreaterThan(SOUNDING);
    await expect.poll(level, TIMEOUT).toBeLessThan(SOUNDING);
    roll.unmount();
  },
  30_000,
);

test.each(INSTRUMENTS)(
  "a key from a device not playing MPE auditions for the fixed time through %s",
  async (_, instrument) => {
    const { level } = listenToAuditions();
    const roll = await renderRoll({ instrument });
    roll.send(0x90, 60, 100);
    await wait(100);
    expect(level()).toBeGreaterThan(SOUNDING);
    await expect.poll(level, TIMEOUT).toBeLessThan(SOUNDING);
    roll.unmount();
  },
  30_000,
);

test.each(INSTRUMENTS)(
  "a first chord on an unconfigured device holds both notes through %s",
  async (_, __, instrument) => {
    const { level } = listenToAuditions();
    const roll = await renderRoll({ instrument });
    roll.send(0x91, 60, 100);
    await wait(100);
    roll.send(0x92, 67, 100);
    roll.send(0x82, 67, 0);
    // The second note has gone, or nearly, so what's left is mostly the first.
    await wait(PAST_A_FIXED_AUDITION_MS + RELEASE * 1000);
    expect(level()).toBeGreaterThan(SOUNDING);
    roll.send(0x81, 60, 0);
    await wait(500);
    expect(level()).toBeGreaterThan(SOUNDING);
    await expect.poll(level, TIMEOUT).toBeLessThan(SOUNDING);
    roll.unmount();
  },
  30_000,
);

test.each(INSTRUMENTS)(
  "a key whose fixed audition has ended doesn't start again through %s",
  async (_, instrument) => {
    const { level } = listenToAuditions();
    const roll = await renderRoll({ instrument });
    roll.send(0x91, 60, 100);
    await expect.poll(level, TIMEOUT).toBeLessThan(SOUNDING);
    await wait(PAST_A_FIXED_AUDITION_MS);
    roll.send(0x92, 67, 100);
    await wait(100);
    roll.send(0x82, 67, 0);
    await expect.poll(level, TIMEOUT).toBeLessThan(SOUNDING);
    roll.unmount();
  },
  30_000,
);
