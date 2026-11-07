import { useMemo, useState } from "react";
import { expect, onTestFinished, test, vi } from "vitest";
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
import { sourceTrackEffectTrackId } from "../../fx-stack.ts";
import {
  DEFAULT_INSTRUMENT,
  DEFAULT_SYNTH_PARAMS,
  type MidiNote,
  type SynthParams,
} from "../../midi-clip.ts";
import { defaultMidiTimeline } from "../../midi-clip-timeline.ts";
import { midiHistoryLabels } from "../../midi-editing.ts";
import { addDefaultSynth, createSynthEffect } from "../../midi-effects.ts";
import {
  COMPUTER_KEYBOARD_STORAGE_KEY,
  computerKeyboardEntry,
  createComputerKeyboardEntry,
} from "../../midi-input/computer-keyboard.ts";
import { createMidiInputHub } from "../../midi-input/input-hub.ts";
import { NEW_NOTE_VELOCITY } from "../../midi-piano-roll.ts";
import { createPlayheadSignal } from "../../playhead-signal.ts";
import {
  type ArmedAuditionSession,
  setArmedAuditionSource,
} from "../../recording/armed-audition.ts";
import { disarmAllTracks, setTrackArmed } from "../../recording/record-arm.ts";
import { INACTIVE_KEY_MAP } from "../fx/key-map-context";
import { FxModulationClockContext } from "../fx/modulation-clock";
import { KeyInputControl } from "../InputModeControl";
import { PianoRoll } from "./PianoRoll";

// Playing the piano roll from the typing keyboard (#1569): keys audition, and
// write notes while the transport plays, with no MIDI device or MIDI on.

function memoryStorage(enabled: boolean) {
  const items = new Map<string, string>([
    [COMPUTER_KEYBOARD_STORAGE_KEY, JSON.stringify({ enabled })],
  ]);
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
}

async function renderRoll({
  on = true,
  playing = true,
}: {
  on?: boolean;
  playing?: boolean;
} = {}) {
  const signal = createPlayheadSignal(0);
  const edits: { notes: readonly MidiNote[]; label: string }[] = [];
  const auditions: number[] = [];
  const request = vi.fn(async () => undefined);
  const hub = createMidiInputHub({
    requestAccess: request,
    loadMappings: async () => [],
    storage: { getItem: () => null, setItem: () => {} },
  });
  const entry = createComputerKeyboardEntry({ storage: memoryStorage(on) });
  function Roll() {
    const [current, setCurrent] = useState<readonly MidiNote[]>([]);
    const clock = useMemo(
      () => ({
        signal,
        bpm: 120,
        signature: { numerator: 4, denominator: 4 },
        isPlaying: playing,
      }),
      [],
    );
    return (
      <FxModulationClockContext.Provider value={clock}>
        <input aria-label="Text field" />
        <KeyInputControl entry={entry} map={INACTIVE_KEY_MAP} />
        <PianoRoll
          collapsed={false}
          keyboardEntry={entry}
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
  onTestFinished(() => screen.unmount());
  return {
    auditions,
    edits,
    entry,
    request,
    signal,
    held: () => document.querySelector("[data-piano-roll-held-note]"),
    toggle: () => page.getByRole("button", { name: "Key on" }),
    off: () => page.getByRole("button", { name: "Key off" }),
    octave: () => document.querySelector(".piano-roll__keyboard-octave"),
  };
}

// Fires a key at the focused element, or the page, and returns whether a
// listener let it through.
function fire(
  type: "keydown" | "keyup",
  code: string,
  init?: KeyboardEventInit,
) {
  const event = new KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    code,
    key: code.replace("Key", "").toLowerCase(),
    ...init,
  });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return !event.defaultPrevented;
}

test("a note key draws a note from key down to key up", async () => {
  const roll = await renderRoll();
  roll.signal.set(1);
  fire("keydown", "KeyD");
  expect(roll.auditions).toEqual([64]);
  await expect.poll(roll.held).not.toBeNull();
  roll.signal.set(2.5);
  fire("keyup", "KeyD");
  await expect.poll(() => roll.edits.length).toBe(1);
  expect(roll.edits[0]).toEqual({
    notes: [{ pitch: 64, start: 1, length: 1.5, velocity: NEW_NOTE_VELOCITY }],
    label: midiHistoryLabels.recordNote,
  });
  expect(roll.held()).toBeNull();
});

test("real key presses reach the entry", async () => {
  const roll = await renderRoll({ playing: false });
  await userEvent.keyboard("{w}");
  expect(roll.auditions).toEqual([61]);
});

test("with the transport stopped a key auditions and writes nothing", async () => {
  const roll = await renderRoll({ playing: false });
  fire("keydown", "KeyA");
  fire("keyup", "KeyA");
  expect(roll.auditions).toEqual([60]);
  expect(roll.held()).toBeNull();
  expect(roll.edits).toEqual([]);
});

test("held keys highlight their pitches and leave the roll's scroll alone", async () => {
  await renderRoll({ playing: false });
  const scroller = document.querySelector(".piano-roll__scroll");
  if (!scroller) {
    throw new Error("no piano roll scroller");
  }
  const before = { top: scroller.scrollTop, left: scroller.scrollLeft };
  const rows = () =>
    [...document.querySelectorAll("[data-piano-roll-played-row]")].map((row) =>
      row.getAttribute("data-piano-roll-played-row"),
    );
  fire("keydown", "KeyA");
  fire("keydown", "KeyD");
  await expect.poll(rows).toEqual(["64", "60"]);
  expect(document.querySelectorAll(".piano-roll__key--played").length).toBe(2);
  fire("keyup", "KeyA");
  await expect.poll(rows).toEqual(["64"]);
  fire("keyup", "KeyD");
  await expect.poll(rows).toEqual([]);
  expect({ top: scroller.scrollTop, left: scroller.scrollLeft }).toEqual(
    before,
  );
});

test("Z and X shift the octave up to the roll's limits", async () => {
  const roll = await renderRoll({ playing: false });
  expect(roll.octave()?.textContent).toBe("C4");
  fire("keydown", "KeyX");
  await expect.poll(() => roll.octave()?.textContent).toBe("C5");
  fire("keyup", "KeyX");
  fire("keydown", "KeyK");
  fire("keyup", "KeyK");
  expect(roll.auditions).toEqual([84]);
  for (let press = 0; press < 10; press += 1) {
    fire("keydown", "KeyX");
    fire("keyup", "KeyX");
  }
  fire("keydown", "KeyK");
  fire("keyup", "KeyK");
  expect(roll.auditions.at(-1)).toBe(108);
  for (let press = 0; press < 10; press += 1) {
    fire("keydown", "KeyZ");
    fire("keyup", "KeyZ");
  }
  fire("keydown", "KeyA");
  fire("keyup", "KeyA");
  expect(roll.auditions.at(-1)).toBe(24);
});

test("an octave shift while a key is held ends the note it started", async () => {
  const roll = await renderRoll();
  fire("keydown", "KeyA");
  fire("keydown", "KeyX");
  roll.signal.set(1);
  fire("keyup", "KeyA");
  await expect.poll(() => roll.edits.length).toBe(1);
  expect(roll.edits[0].notes[0].pitch).toBe(60);
});

test("with entry off letter keys are left alone", async () => {
  const roll = await renderRoll({ on: false });
  await expect.element(roll.toggle()).toHaveAttribute("aria-pressed", "false");
  expect(fire("keydown", "KeyA")).toBe(true);
  expect(fire("keydown", "KeyZ")).toBe(true);
  expect(roll.auditions).toEqual([]);
  expect(roll.entry.getState().basePitch).toBe(60);
});

test("the toggle turns entry on and off without touching MIDI", async () => {
  const roll = await renderRoll({ on: false, playing: false });
  await userEvent.click(roll.toggle());
  await expect.element(roll.toggle()).toHaveAttribute("aria-pressed", "true");
  fire("keydown", "KeyA");
  fire("keyup", "KeyA");
  expect(roll.auditions).toEqual([60]);
  expect(roll.request).not.toHaveBeenCalled();
  await userEvent.click(roll.off());
  await expect.element(roll.toggle()).toHaveAttribute("aria-pressed", "false");
  expect(fire("keydown", "KeyA")).toBe(true);
  expect(roll.auditions).toEqual([60]);
});

test("typing in a text field types text and plays nothing", async () => {
  const roll = await renderRoll();
  const field = page.getByRole("textbox", { name: "Text field" });
  await userEvent.click(field);
  await userEvent.keyboard("asdzx");
  await expect.element(field).toHaveValue("asdzx");
  expect(roll.auditions).toEqual([]);
  expect(roll.entry.getState().basePitch).toBe(60);
});

test("an open menu keeps its letter keys", async () => {
  const roll = await renderRoll();
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  document.body.append(menu);
  onTestFinished(() => menu.remove());
  expect(fire("keydown", "KeyA")).toBe(true);
  expect(roll.auditions).toEqual([]);
});

test("a key Key Map mode just took plays nothing", async () => {
  const roll = await renderRoll();
  const take = (event: KeyboardEvent) => event.preventDefault();
  window.addEventListener("keydown", take, true);
  onTestFinished(() => window.removeEventListener("keydown", take, true));
  // The entry's listener came first in this test, so re-add it after `take`.
  roll.entry.setEnabled(false);
  await expect.element(roll.toggle()).toHaveAttribute("aria-pressed", "false");
  roll.entry.setEnabled(true);
  await expect.element(roll.toggle()).toHaveAttribute("aria-pressed", "true");
  fire("keydown", "KeyA");
  expect(roll.auditions).toEqual([]);
});

test("holding a key plays one note", async () => {
  const roll = await renderRoll();
  fire("keydown", "KeyA");
  expect(fire("keydown", "KeyA", { repeat: true })).toBe(false);
  expect(fire("keydown", "KeyA", { repeat: true })).toBe(false);
  expect(roll.auditions).toEqual([60]);
  roll.signal.set(1);
  fire("keyup", "KeyA");
  await expect.poll(() => roll.edits.length).toBe(1);
  expect(roll.edits[0].notes).toHaveLength(1);
});

test("losing focus ends a held note and its later release does nothing", async () => {
  const roll = await renderRoll();
  fire("keydown", "KeyA");
  await expect.poll(roll.held).not.toBeNull();
  roll.signal.set(1);
  window.dispatchEvent(new Event("blur"));
  await expect.poll(() => roll.edits.length).toBe(1);
  expect(roll.held()).toBeNull();
  roll.signal.set(2);
  expect(fire("keyup", "KeyA")).toBe(true);
  expect(roll.edits).toHaveLength(1);
});

test("turning entry off ends a held note", async () => {
  const roll = await renderRoll();
  fire("keydown", "KeyA");
  await expect.poll(roll.held).not.toBeNull();
  roll.signal.set(1);
  roll.entry.setEnabled(false);
  await expect.poll(() => roll.edits.length).toBe(1);
  expect(roll.edits[0].notes[0]).toMatchObject({ pitch: 60, length: 1 });
});

test("Cmd going down ends held notes, since macOS drops their keyup", async () => {
  const roll = await renderRoll();
  fire("keydown", "KeyA");
  roll.signal.set(1);
  fire("keydown", "MetaLeft", { key: "Meta", metaKey: true });
  await expect.poll(() => roll.edits.length).toBe(1);
});

test("other keys and modified letters pass through with entry on", async () => {
  const roll = await renderRoll({ playing: false });
  for (const code of ["ArrowUp", "Delete", "Escape", "KeyQ", "KeyL"]) {
    expect(fire("keydown", code)).toBe(true);
  }
  expect(fire("keydown", "KeyZ", { ctrlKey: true })).toBe(true);
  expect(fire("keydown", "KeyD", { metaKey: true })).toBe(true);
  expect(fire("keydown", "KeyS", { altKey: true })).toBe(true);
  expect(fire("keydown", "KeyA", { shiftKey: true })).toBe(true);
  expect(roll.auditions).toEqual([]);
  expect(roll.entry.getState().basePitch).toBe(60);
});

test(
  "in the editor, entry draws notes with undo and redo and keeps Space",
  async () => {
    await setViewport({ width: 1280, height: 960 });
    localStorage.removeItem(COMPUTER_KEYBOARD_STORAGE_KEY);
    onTestFinished(() => {
      computerKeyboardEntry.setEnabled(false);
      localStorage.removeItem(COMPUTER_KEYBOARD_STORAGE_KEY);
    });
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
        effects: addDefaultSynth(base.effects, "bass", "bass-synth"),
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
    await userEvent.click(page.getByRole("button", { name: "Key on" }));
    expect(localStorage.getItem(COMPUTER_KEYBOARD_STORAGE_KEY)).toContain(
      "true",
    );

    // Stopped, a key only auditions.
    await userEvent.keyboard("{a}");
    expect(notes()).toEqual([]);

    // Space still plays, and pauses, with entry on.
    await userEvent.keyboard(" ");
    await expect
      .element(page.getByRole("button", { name: "Pause playback" }))
      .toBeVisible();
    await userEvent.keyboard("{d>}");
    await expect
      .poll(() => document.querySelector("[data-piano-roll-held-note='64']"))
      .not.toBeNull();
    await userEvent.keyboard("{/d}");
    await expect.poll(() => notes()?.length).toBe(1);
    expect(notes()?.[0]).toMatchObject({
      pitch: 64,
      velocity: NEW_NOTE_VELOCITY,
    });
    const drawn = notes();
    await userEvent.keyboard(" ");
    await expect
      .element(page.getByRole("button", { name: "Play timeline" }))
      .toBeVisible();

    await undo();
    await expect.poll(() => notes()).toEqual([]);
    await redo();
    await expect.poll(() => notes()).toEqual(drawn);
  },
  EDITOR_TEST_TIMEOUT,
);

test("an open roll's keys also sound the other armed tracks", async () => {
  const types: OscillatorType[] = [];
  const createOscillator = AudioContext.prototype.createOscillator;
  const spy = vi
    .spyOn(AudioContext.prototype, "createOscillator")
    .mockImplementation(function (this: AudioContext) {
      const oscillator = createOscillator.call(this);
      queueMicrotask(() => types.push(oscillator.type));
      return oscillator;
    });
  const wave = (wave: SynthParams["wave"], trackId: string) =>
    createSynthEffect(sourceTrackEffectTrackId(trackId), {
      ...DEFAULT_SYNTH_PARAMS,
      wave,
    });
  setArmedAuditionSource(
    {
      clips: [],
      lanes: [],
      mediaItems: [],
      sourceTracks: [{ id: "own" }, { id: "other" }],
      sourceSpans: [
        { id: "clip", sourceTrackId: "own", startQ: 0, notes: [] },
        { id: "theirs", sourceTrackId: "other", startQ: 0, notes: [] },
      ],
      effects: [wave("square", "own"), wave("sawtooth", "other")],
    } as unknown as ArmedAuditionSession,
    () => 0,
  );
  setTrackArmed("own", true);
  setTrackArmed("other", true);
  onTestFinished(() => {
    spy.mockRestore();
    disarmAllTracks();
  });
  const roll = await renderRoll({ playing: false });
  fire("keydown", "KeyA");
  fire("keyup", "KeyA");
  expect(roll.auditions).toEqual([60]);
  await expect.poll(() => types).toEqual(["sawtooth"]);
});
