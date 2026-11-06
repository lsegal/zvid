import { useMemo, useState } from "react";
import { expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { INITIAL_PROJECT_STATE } from "../../app/constants.ts";
import type { ProjectState } from "../../app/types.ts";
import {
  EDITOR_TEST_TIMEOUT,
  renderEditor,
  withTestPatternTrack,
} from "../../component-test/editor.tsx";
import { redo, undo } from "../../component-test/input.ts";
import { setViewport } from "../../component-test/viewport.ts";
import { DEFAULT_INSTRUMENT, type MidiNote } from "../../midi-clip.ts";
import { defaultMidiTimeline } from "../../midi-clip-timeline.ts";
import { midiHistoryLabels } from "../../midi-editing.ts";
import { addDefaultSynth } from "../../midi-effects.ts";
import {
  createMidiInputHub,
  type MidiInputPort,
} from "../../midi-input/input-hub.ts";
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
          onAudition={(pitch) => auditions.push(pitch)}
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
    await vi.waitFor(() => expect(port.onmidimessage).not.toBeNull());
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
