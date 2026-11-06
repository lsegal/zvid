import { useMemo, useState } from "react";
import { expect, onTestFinished, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { INITIAL_PROJECT_STATE } from "../../app/constants.ts";
import type { ProjectState } from "../../app/types.ts";
import { renderSynthClip } from "../../audio-mix/synth.ts";
import {
  EDITOR_TEST_TIMEOUT,
  renderEditor,
  withTestPatternTrack,
} from "../../component-test/editor.tsx";
import { redo, undo } from "../../component-test/input.ts";
import { setViewport } from "../../component-test/viewport.ts";
import {
  DEFAULT_INSTRUMENT,
  DEFAULT_SYNTH_PARAMS,
  type MidiNote,
} from "../../midi-clip.ts";
import { defaultMidiTimeline } from "../../midi-clip-timeline.ts";
import { midiHistoryLabels } from "../../midi-editing.ts";
import { addDefaultSynth } from "../../midi-effects.ts";
import {
  createMidiInputHub,
  type MidiInputPort,
  midiInputHub,
} from "../../midi-input/input-hub.ts";
import { MIDI_INPUT_STORAGE_KEY } from "../../midi-input/preferences.ts";
import { createPlayheadSignal } from "../../playhead-signal.ts";
import { FxModulationClockContext } from "../fx/modulation-clock";
import { PianoRoll } from "./PianoRoll";

// Playing the piano roll from a MIDI keyboard (#1554), through a simulated
// device: keys audition, and write notes while the transport plays.

const MAPPED = {
  id: "test-keys",
  manufacturer: "Test",
  model: "Keys 49",
  portNames: ["test keys"],
  source: {
    url: "https://example.com",
    title: "Test",
    verification: "documented" as const,
  },
  controls: [
    {
      name: "Key {n}",
      kind: "key" as const,
      type: "note" as const,
      channel: 1,
      number: 36,
      count: 49,
    },
    {
      name: "Knob",
      kind: "knob" as const,
      type: "cc" as const,
      channel: 1,
      number: 21,
    },
    {
      name: "Stop",
      kind: "button" as const,
      type: "note" as const,
      channel: 1,
      number: 93,
    },
  ],
};

function connectedPort(name: string): MidiInputPort {
  return { id: name, name, state: "connected", onmidimessage: null };
}

async function renderRoll({
  playing,
  portName = "Test Keys MIDI 1",
  startNotes = [],
}: {
  playing: boolean;
  portName?: string;
  startNotes?: MidiNote[];
}) {
  const port = connectedPort(portName);
  const access = {
    inputs: new Map([[port.id, port]]),
    onstatechange: null as (() => void) | null,
  };
  const signal = createPlayheadSignal(0);
  const edits: { notes: readonly MidiNote[]; label: string }[] = [];
  const auditions: number[] = [];
  const hub = createMidiInputHub({
    requestAccess: async () => access,
    loadMappings: async () => [MAPPED],
    storage: {
      getItem: () => JSON.stringify({ enabled: true }),
      setItem: () => {},
    },
  });
  let setPlaying: (next: boolean) => void = () => {};
  function Roll() {
    const [current, setCurrent] = useState<readonly MidiNote[]>(startNotes);
    const [isPlaying, setIsPlaying] = useState(playing);
    setPlaying = setIsPlaying;
    const clock = useMemo(
      () => ({
        signal,
        bpm: 120,
        signature: { numerator: 4, denominator: 4 },
        isPlaying,
      }),
      [isPlaying],
    );
    return (
      <FxModulationClockContext.Provider value={clock}>
        <PianoRoll
          collapsed={false}
          midiHub={hub}
          model={{
            spanId: "clip",
            label: "Bassline",
            accent: "#7ca1ff",
            notes: [...current],
            startQ: 0,
            trimStartQ: 0,
            lengthQ: 8,
            timeline: defaultMidiTimeline(8),
            instrument: DEFAULT_INSTRUMENT,
          }}
          onAudition={(pitch) => {
            auditions.push(pitch);
            return undefined;
          }}
          onSetNotes={(_, next, label) => {
            edits.push({ notes: next, label });
            setCurrent(next);
          }}
          onSetTimeline={() => {}}
          onToggleCollapsed={() => {}}
        />
      </FxModulationClockContext.Provider>
    );
  }
  const screen = await render(<Roll />);
  await vi.waitFor(() => expect(port.onmidimessage).not.toBeNull());
  return {
    access,
    port,
    signal,
    edits,
    auditions,
    setPlaying: (next: boolean) => setPlaying(next),
    send: (...bytes: number[]) =>
      port.onmidimessage?.({ data: new Uint8Array(bytes) }),
    status: () => document.querySelector("[data-piano-roll-midi-status]"),
    notes: () => document.querySelectorAll("[data-note-index]"),
    unmount: () => screen.unmount(),
  };
}

test("a key played while the transport plays draws its note", async () => {
  const roll = await renderRoll({ playing: true });
  roll.signal.set(1);
  roll.send(0x90, 60, 90);
  expect(roll.auditions).toEqual([60]);
  await expect
    .poll(() => document.querySelector("[data-piano-roll-held-note='60']"))
    .not.toBeNull();
  roll.signal.set(2.5);
  roll.send(0x80, 60, 0);
  await expect.poll(() => roll.notes().length).toBe(1);
  expect(roll.edits).toEqual([
    {
      notes: [{ pitch: 60, start: 1, length: 1.5, velocity: 90 }],
      label: midiHistoryLabels.recordNote,
    },
  ]);
  expect(document.querySelector("[data-piano-roll-held-note]")).toBeNull();
  roll.unmount();
});

test("a chord released together keeps all of its notes", async () => {
  const roll = await renderRoll({ playing: true });
  roll.signal.set(1);
  roll.send(0x90, 60, 90);
  roll.send(0x90, 64, 80);
  roll.send(0x90, 67, 70);
  roll.signal.set(2);
  roll.send(0x80, 60, 0);
  roll.send(0x80, 64, 0);
  roll.send(0x90, 67, 0);
  await expect.poll(() => roll.notes().length).toBe(3);
  expect(roll.edits.at(-1)?.notes.map((note) => note.velocity)).toEqual([
    90, 80, 70,
  ]);
  roll.unmount();
});

test("a key played out of view scrolls the roll to its pitch", async () => {
  const roll = await renderRoll({ playing: false });
  const scroller = document.querySelector(".piano-roll__scroll");
  const row = () => scroller?.scrollTop;
  const before = row();
  roll.send(0x90, 106, 90);
  roll.send(0x80, 106, 0);
  expect(row()).not.toBe(before);
  const afterHigh = row();
  // Already in view: stays put.
  roll.send(0x90, 105, 90);
  expect(row()).toBe(afterHigh);
  roll.unmount();
});

test("a key played while stopped auditions and writes nothing", async () => {
  const roll = await renderRoll({ playing: false });
  roll.send(0x90, 60, 90);
  roll.send(0x80, 60, 0);
  expect(roll.auditions).toEqual([60]);
  expect(roll.edits).toEqual([]);
  roll.unmount();
});

test("stopping the transport ends a held note where it stopped", async () => {
  const roll = await renderRoll({ playing: true });
  roll.signal.set(1);
  roll.send(0x90, 60, 90);
  roll.signal.set(3);
  roll.setPlaying(false);
  await expect.poll(() => roll.notes().length).toBe(1);
  expect(roll.edits[0].notes[0]).toMatchObject({ start: 1, length: 2 });
  // The key coming up later has nothing left to end.
  roll.send(0x80, 60, 0);
  expect(roll.edits.length).toBe(1);
  roll.unmount();
});

test("the playhead jumping back ends a held note where it was", async () => {
  const roll = await renderRoll({ playing: true });
  roll.signal.set(1);
  roll.send(0x90, 60, 90);
  roll.signal.set(2);
  roll.signal.set(0);
  await expect.poll(() => roll.notes().length).toBe(1);
  expect(roll.edits[0].notes[0]).toMatchObject({ start: 1, length: 1 });
  roll.unmount();
});

test("a device going away ends the notes it was holding", async () => {
  const roll = await renderRoll({ playing: true });
  roll.signal.set(1);
  roll.send(0x90, 60, 90);
  roll.signal.set(2);
  roll.port.state = "disconnected";
  roll.access.onstatechange?.();
  await expect.poll(() => roll.notes().length).toBe(1);
  await expect.poll(() => roll.status()).toBeNull();
  roll.unmount();
});

test("a mapped device's knobs and buttons change nothing", async () => {
  const roll = await renderRoll({ playing: true });
  await expect.poll(() => roll.status()?.textContent).toBe("Test Keys 49");
  roll.signal.set(1);
  roll.send(0xb0, 21, 64);
  roll.send(0x90, 93, 127);
  roll.send(0x80, 93, 0);
  roll.signal.set(2);
  expect(roll.auditions).toEqual([]);
  expect(roll.edits).toEqual([]);
  roll.unmount();
});

test("a device with no mapping plays through the standard layout", async () => {
  const roll = await renderRoll({ playing: true, portName: "Homemade Thing" });
  await expect.poll(() => roll.status()?.textContent).toBe("Homemade Thing");
  roll.signal.set(1);
  // Its note 93 is just a key, unlike the mapped device's Stop button.
  roll.send(0x90, 93, 100);
  roll.signal.set(2);
  roll.send(0x80, 93, 0);
  await expect.poll(() => roll.notes().length).toBe(1);
  expect(roll.edits[0].notes[0]).toMatchObject({ pitch: 93, velocity: 100 });
  roll.unmount();
});

test("notes outside the roll's keys are ignored", async () => {
  const roll = await renderRoll({ playing: true });
  roll.signal.set(1);
  roll.send(0x90, 12, 100);
  roll.send(0x90, 120, 100);
  roll.signal.set(2);
  roll.send(0x80, 12, 0);
  roll.send(0x80, 120, 0);
  expect(roll.auditions).toEqual([]);
  expect(roll.edits).toEqual([]);
  roll.unmount();
});

test(
  "undo removes a note drawn from MIDI and redo restores it, in the editor",
  async () => {
    const port = connectedPort("Homemade Thing");
    Object.defineProperty(navigator, "requestMIDIAccess", {
      configurable: true,
      value: async () => ({
        inputs: new Map([[port.id, port]]),
        onstatechange: null,
      }),
    });
    await setViewport({ width: 1280, height: 960 });
    const base = withTestPatternTrack(INITIAL_PROJECT_STATE);
    let state: ProjectState | undefined;
    await renderEditor({
      project: {
        ...base,
        sourceTracks: [
          ...base.sourceTracks,
          { id: "bass", name: "Bass", colorIndex: 2, recordingPaths: [] },
        ],
        sourceSpans: [
          ...base.sourceSpans,
          {
            id: "source-bassline",
            sourceTrackId: "bass",
            label: "Bassline",
            mediaPath: "",
            startQ: 0,
            durationSeconds: (32 * 60) / base.bpm,
            trimStartSeconds: 0,
            notes: [],
            tint: "#1c2340",
            accent: "#7ca1ff",
          },
        ],
        effects: addDefaultSynth(base.effects, "source-bassline", "bass-synth"),
      },
      onState: (next) => {
        state = next.project;
      },
    });
    const notes = () =>
      state?.sourceSpans.find((span) => span.id === "source-bassline")?.notes;
    const clip = document.querySelector<HTMLElement>(
      '[data-source-span-id="source-bassline"]',
    );
    if (!clip) {
      throw new Error("missing the MIDI clip");
    }
    await userEvent.click(clip);
    await expect
      .element(page.getByRole("region", { name: "Bassline notes" }))
      .toBeVisible();
    // MIDI starts off, and isn't asked for until it's turned on.
    expect(port.onmidimessage).toBeNull();
    const before = state;
    onTestFinished(() => {
      midiInputHub.setEnabled(false);
      localStorage.removeItem(MIDI_INPUT_STORAGE_KEY);
    });
    await userEvent.click(page.getByRole("button", { name: "MIDI input" }));
    await vi.waitFor(() => expect(port.onmidimessage).not.toBeNull());
    // A per-browser preference, not part of the session.
    expect(localStorage.getItem(MIDI_INPUT_STORAGE_KEY)).toContain("true");
    expect(state).toBe(before);
    const send = (...bytes: number[]) =>
      port.onmidimessage?.({ data: new Uint8Array(bytes) });

    // Stopped, a key only auditions.
    send(0x90, 60, 90);
    send(0x80, 60, 0);
    expect(notes()).toEqual([]);

    await userEvent.click(page.getByRole("button", { name: "Play timeline" }));
    send(0x90, 60, 90);
    await expect
      .poll(() => document.querySelector("[data-piano-roll-held-note='60']"))
      .not.toBeNull();
    send(0x80, 60, 0);
    await expect.poll(() => notes()?.length).toBe(1);
    expect(notes()?.[0]).toMatchObject({ pitch: 60, velocity: 90 });
    const drawn = notes();
    await userEvent.click(page.getByRole("button", { name: "Pause playback" }));

    await undo();
    await expect.poll(() => notes()).toEqual([]);
    await redo();
    await expect.poll(() => notes()).toEqual(drawn);
  },
  EDITOR_TEST_TIMEOUT,
);

// MPE (#1556), through the same simulated device: a note on each channel, its
// bend, pressure and CC 74 its own.
function mpeBytes(roll: { send: (...bytes: number[]) => void }) {
  return {
    configure(manager: number, members: number) {
      const status = 0xb0 | (manager - 1);
      roll.send(status, 101, 0);
      roll.send(status, 100, 6);
      roll.send(status, 6, members);
    },
    bendUp: (channel: number) => roll.send(0xe0 | (channel - 1), 0x7f, 0x7f),
    bendDown: (channel: number) => roll.send(0xe0 | (channel - 1), 0, 0),
    press: (channel: number, pressure: number) =>
      roll.send(0xd0 | (channel - 1), pressure),
    slide: (channel: number, value: number) =>
      roll.send(0xb0 | (channel - 1), 74, value),
    on: (channel: number, pitch: number) =>
      roll.send(0x90 | (channel - 1), pitch, 100),
    off: (channel: number, pitch: number) =>
      roll.send(0x80 | (channel - 1), pitch, 0),
  };
}

test("two held MPE notes bend to different pitches independently", async () => {
  const roll = await renderRoll({ playing: true });
  const mpe = mpeBytes(roll);
  mpe.configure(1, 15);
  roll.signal.set(1);
  mpe.on(2, 60);
  mpe.on(3, 64);
  roll.signal.set(2);
  mpe.bendUp(2);
  mpe.bendDown(3);
  roll.signal.set(3);
  mpe.off(2, 60);
  mpe.off(3, 64);
  await expect.poll(() => roll.notes().length).toBe(2);
  const notes = roll.edits.at(-1)?.notes ?? [];
  expect(notes.find((note) => note.pitch === 60)?.expression).toEqual({
    bend: [
      { at: 0, value: 0 },
      { at: 1, value: 48 },
    ],
  });
  expect(notes.find((note) => note.pitch === 64)?.expression).toEqual({
    bend: [
      { at: 0, value: 0 },
      { at: 1, value: -48 },
    ],
  });
  roll.unmount();
});

test("pressure and slide go to the note on their channel, and a manager to all", async () => {
  const roll = await renderRoll({ playing: true });
  const mpe = mpeBytes(roll);
  mpe.configure(16, 15);
  roll.signal.set(1);
  mpe.on(15, 60);
  mpe.on(14, 64);
  roll.signal.set(1.5);
  mpe.press(15, 127);
  mpe.slide(14, 127);
  roll.signal.set(2);
  mpe.bendUp(16);
  roll.signal.set(3);
  mpe.off(15, 60);
  mpe.off(14, 64);
  await expect.poll(() => roll.notes().length).toBe(2);
  const notes = roll.edits.at(-1)?.notes ?? [];
  const first = notes.find((note) => note.pitch === 60)?.expression;
  const second = notes.find((note) => note.pitch === 64)?.expression;
  expect(first?.pressure).toEqual([{ at: 0, value: 1 }]);
  expect(first?.timbre).toBeUndefined();
  expect(second?.timbre).toEqual([{ at: 0, value: 1 }]);
  expect(second?.pressure).toBeUndefined();
  for (const expression of [first, second]) {
    expect(expression?.bend).toEqual([
      { at: 0, value: 0 },
      { at: 1, value: 2 },
    ]);
  }
  roll.unmount();
});

test("a device that plays two member channels counts as MPE unconfigured", async () => {
  const roll = await renderRoll({ playing: true });
  const mpe = mpeBytes(roll);
  roll.signal.set(1);
  mpe.on(2, 60);
  roll.signal.set(1.5);
  mpe.bendUp(2);
  mpe.on(3, 64);
  roll.signal.set(2);
  mpe.off(2, 60);
  mpe.off(3, 64);
  await expect.poll(() => roll.notes().length).toBe(2);
  const notes = roll.edits.at(-1)?.notes ?? [];
  expect(
    notes.find((note) => note.pitch === 60)?.expression?.bend?.at(-1),
  ).toEqual({ at: 0.5, value: 48 });
  roll.unmount();
});

test("a keyboard that isn't MPE records no expression from its wheel", async () => {
  const roll = await renderRoll({ playing: true });
  const mpe = mpeBytes(roll);
  roll.signal.set(1);
  mpe.on(1, 60);
  roll.signal.set(2);
  mpe.bendUp(1);
  mpe.press(1, 100);
  roll.signal.set(3);
  mpe.off(1, 60);
  await expect.poll(() => roll.notes().length).toBe(1);
  expect(roll.edits.at(-1)?.notes).toEqual([
    { pitch: 60, start: 1, length: 2, velocity: 100 },
  ]);
  roll.unmount();
});

// The strongest frequency's period in `samples`, from their rising crossings.
function frequencyOf(samples: Float32Array, sampleRate: number) {
  const crossings: number[] = [];
  for (let index = 1; index < samples.length; index++) {
    if (samples[index - 1] < 0 && samples[index] >= 0) {
      crossings.push(index);
    }
  }
  const span = crossings[crossings.length - 1] - crossings[0];
  return ((crossings.length - 1) / span) * sampleRate;
}

test("a recorded bend, swell and slide are heard, the same each render", async () => {
  const instrument = {
    kind: "synth" as const,
    params: {
      ...DEFAULT_SYNTH_PARAMS,
      wave: "sine" as const,
      cutoff: 20_000,
    },
  };
  const sampleRate = 44_100;
  const render = (expression?: MidiNote["expression"]) =>
    renderSynthClip(
      {
        notes: [
          {
            pitch: 69,
            start: 0,
            length: 2,
            velocity: 127,
            ...(expression ? { expression } : {}),
          },
        ],
        instrument,
        durationSeconds: 1,
      },
      120,
      sampleRate,
    );
  const slice = (audio: { channels: Float32Array[] }) =>
    audio.channels[0].subarray(sampleRate * 0.2, sampleRate * 0.8);
  const plain = slice(await render());
  const peak = (samples: Float32Array) =>
    samples.reduce((most, value) => Math.max(most, Math.abs(value)), 0);

  // A held note an octave up: its preview and export both render through here.
  const bend = [{ at: 0, value: 12 }];
  const bent = slice(await render({ bend }));
  expect(frequencyOf(plain, sampleRate)).toBeCloseTo(440, 0);
  expect(frequencyOf(bent, sampleRate)).toBeCloseTo(880, 0);
  expect(slice(await render({ bend }))).toEqual(bent);

  const unpressed = slice(await render({ pressure: [{ at: 0, value: 0 }] }));
  expect(peak(unpressed)).toBeLessThan(peak(plain) / 2);

  // A sawtooth's harmonics through the filter a slide closes.
  const saw = {
    kind: "synth" as const,
    params: { ...DEFAULT_SYNTH_PARAMS, cutoff: 1000 },
  };
  const sawRender = async (expression?: MidiNote["expression"]) =>
    slice(
      await renderSynthClip(
        {
          notes: [
            {
              pitch: 69,
              start: 0,
              length: 2,
              velocity: 127,
              ...(expression ? { expression } : {}),
            },
          ],
          instrument: saw,
          durationSeconds: 1,
        },
        120,
        sampleRate,
      ),
    );
  expect(peak(await sawRender({ timbre: [{ at: 0, value: 0 }] }))).toBeLessThan(
    peak(await sawRender()),
  );
});

test("an audition follows its key's expression", async () => {
  const updates: unknown[] = [];
  const access = {
    inputs: new Map<string, MidiInputPort>(),
    onstatechange: null as (() => void) | null,
  };
  const port = connectedPort("Test MPE");
  access.inputs.set(port.id, port);
  const hub = createMidiInputHub({
    requestAccess: async () => access,
    loadMappings: async () => [],
    storage: {
      getItem: () => JSON.stringify({ enabled: true }),
      setItem: () => {},
    },
  });
  const started: unknown[] = [];
  const screen = await render(
    <PianoRoll
      collapsed={false}
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
        instrument: DEFAULT_INSTRUMENT,
      }}
      onAudition={(pitch, _, expression) => {
        started.push([pitch, expression]);
        return { update: (sample) => updates.push(sample) };
      }}
      onSetNotes={() => {}}
      onSetTimeline={() => {}}
      onToggleCollapsed={() => {}}
    />,
  );
  await vi.waitFor(() => expect(port.onmidimessage).not.toBeNull());
  const send = (...bytes: number[]) =>
    port.onmidimessage?.({ data: new Uint8Array(bytes) });
  const mpe = mpeBytes({ send });
  mpe.configure(1, 15);
  mpe.press(2, 127);
  mpe.on(2, 60);
  expect(started).toEqual([[60, { bend: 0, pressure: 1 }]]);
  mpe.bendUp(2);
  expect(updates).toEqual([{ bend: 48, pressure: 1 }]);
  screen.unmount();
});
