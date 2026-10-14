import { useState } from "react";
import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { INITIAL_PROJECT_STATE } from "../../app/constants.ts";
import type { ProjectState } from "../../app/types.ts";
import {
  EDITOR_TEST_TIMEOUT,
  renderEditor,
  withTestPatternTrack,
} from "../../component-test/editor.tsx";
import { center, click, drag, undo } from "../../component-test/input.ts";
import { setViewport } from "../../component-test/viewport.ts";
import { installHarness } from "../../harness";
import { DEFAULT_INSTRUMENT, type MidiNote } from "../../midi-clip.ts";
import { defaultMidiTimeline } from "../../midi-clip-timeline.ts";
import { midiHistoryLabels } from "../../midi-editing.ts";
import { addDefaultSynth } from "../../midi-effects.ts";
import {
  VELOCITY_LANE_DEFAULT_PX,
  VELOCITY_LANE_STORAGE_KEY,
} from "../../piano-roll-velocity.ts";
import { PIANO_ROLL_QUARTER_PX, PianoRoll } from "./PianoRoll";

// The piano roll's velocity lane (#1403): a stem per note along the bottom
// of the grid, dragged to set velocities, one undo step per drag, and a top
// edge that resizes the lane.

const NOTES: MidiNote[] = [
  { pitch: 48, start: 0, length: 1, velocity: 100 },
  { pitch: 55, start: 2, length: 1, velocity: 100 },
  { pitch: 60, start: 4, length: 2, velocity: 100 },
];

// The roll on its own, keeping the notes it sets and the labels it sets
// them with.
async function renderRoll(notes = NOTES) {
  await installHarness();
  const edits: { notes: readonly MidiNote[]; label: string }[] = [];
  function Roll() {
    const [current, setCurrent] = useState<readonly MidiNote[]>(notes);
    return (
      <PianoRoll
        collapsed={false}
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
        onAudition={() => {}}
        onSetNotes={(_, next, label) => {
          edits.push({ notes: next, label });
          setCurrent(next);
        }}
        onSetTimeline={() => {}}
        onToggleCollapsed={() => {}}
      />
    );
  }
  const screen = await render(<Roll />);
  await expect
    .element(page.getByRole("region", { name: "Bassline notes" }))
    .toBeVisible();
  return {
    edits,
    unmount: () => screen.unmount(),
    last: () => edits.at(-1)?.notes.map((note) => note.velocity),
  };
}

function lane() {
  const element = document.querySelector<HTMLElement>(
    "[data-piano-roll-velocity]",
  );
  if (!element) {
    throw new Error("missing the velocity lane");
  }
  return element;
}

function stem(index: number) {
  const element = document.querySelector<HTMLElement>(
    `[data-stem-index="${index}"]`,
  );
  if (!element) {
    throw new Error(`missing stem ${index}`);
  }
  return element;
}

function note(index: number) {
  const element = document.querySelector<HTMLElement>(
    `[data-note-index="${index}"]`,
  );
  if (!element) {
    throw new Error(`missing note ${index}`);
  }
  return element;
}

// The client y of `velocity` in the lane, below its 5px resize edge.
function velocityY(velocity: number) {
  const box = lane().getBoundingClientRect();
  const stems = box.height - 5;
  return box.bottom - (velocity / 127) * stems;
}

test("the lane shows a stem at each note's start, as tall as its velocity", async () => {
  await renderRoll([
    { pitch: 48, start: 0, length: 1, velocity: 127 },
    { pitch: 55, start: 2, length: 1, velocity: 64 },
  ]);
  const laneBox = lane().getBoundingClientRect();
  expect(laneBox.height).toBe(VELOCITY_LANE_DEFAULT_PX);
  const stems = laneBox.height - 5;
  for (const index of [0, 1]) {
    const noteBox = note(index).getBoundingClientRect();
    const stemBox = stem(index).getBoundingClientRect();
    expect(Math.abs(stemBox.left - noteBox.left)).toBeLessThan(1.5);
    expect(Math.abs(stemBox.bottom - laneBox.bottom)).toBeLessThan(1.5);
  }
  expect(stem(0).getBoundingClientRect().height).toBeCloseTo(stems, 0);
  expect(stem(1).getBoundingClientRect().height).toBeCloseTo(
    (stems * 64) / 127,
    0,
  );
  expect(stem(1).getAttribute("aria-valuenow")).toBe("64");
});

test("dragging a stem sets its note's velocity as one edit", async () => {
  const { edits, last } = await renderRoll();
  const from = center(stem(1));
  await drag(
    { x: from.x + 1, y: velocityY(100) },
    { x: from.x + 1, y: velocityY(40) },
  );
  await expect.poll(() => edits.length).toBe(1);
  expect(edits[0].label).toBe(midiHistoryLabels.setVelocity);
  const [first, second, third] = last() ?? [];
  expect([first, third]).toEqual([100, 100]);
  expect(Math.abs(second - 40)).toBeLessThanOrEqual(2);
  expect(stem(1).getAttribute("aria-valuenow")).toBe(String(second));

  // Dragging past the lane's edges clamps to 1 and 127.
  await drag(
    { x: from.x + 1, y: velocityY(40) },
    { x: from.x + 1, y: velocityY(0) + 40 },
  );
  await expect.poll(() => last()?.[1]).toBe(1);
  await drag(
    { x: from.x + 1, y: velocityY(1) },
    { x: from.x + 1, y: velocityY(127) - 80 },
  );
  await expect.poll(() => last()?.[1]).toBe(127);
  expect(edits).toHaveLength(3);
});

test("dragging across the stems paints them in one edit", async () => {
  const { edits, last } = await renderRoll();
  const left = lane().getBoundingClientRect().left;
  await drag(
    { x: left + 1, y: velocityY(30) },
    { x: left + 4 * PIANO_ROLL_QUARTER_PX + 1, y: velocityY(30) },
  );
  await expect.poll(() => edits.length).toBe(1);
  expect(edits[0].label).toBe(midiHistoryLabels.setVelocity);
  for (const velocity of last() ?? []) {
    expect(Math.abs(velocity - 30)).toBeLessThanOrEqual(2);
  }
});

test("dragging a selected note's stem moves every selected note's velocity", async () => {
  const { edits, last } = await renderRoll([
    { pitch: 48, start: 0, length: 1, velocity: 100 },
    { pitch: 55, start: 2, length: 1, velocity: 60 },
    { pitch: 60, start: 4, length: 2, velocity: 100 },
  ]);
  const first = center(note(0));
  await click(first.x, first.y);
  const second = center(note(1));
  await click(second.x, second.y, { modifiers: ["Shift"] });
  await expect
    .poll(() => stem(1).classList.contains("piano-roll__stem--selected"))
    .toBe(true);

  const x = center(stem(0)).x + 1;
  await drag({ x, y: velocityY(100) }, { x, y: velocityY(80) });
  await expect.poll(() => edits.length).toBe(1);
  const [a, b, c] = last() ?? [];
  // Both selected notes drop by the same amount; the third stays.
  expect(100 - a).toBe(60 - b);
  expect(Math.abs(a - 80)).toBeLessThanOrEqual(2);
  expect(c).toBe(100);
});

test("the lane's arrow keys nudge a stem", async () => {
  const { edits, last } = await renderRoll();
  stem(2).focus();
  await userEvent.keyboard("{ArrowUp}");
  await expect.poll(() => last()?.[2]).toBe(101);
  await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
  await expect.poll(() => last()?.[2]).toBe(91);
  expect(edits.map((edit) => edit.label)).toEqual([
    midiHistoryLabels.setVelocity,
    midiHistoryLabels.setVelocity,
  ]);
});

test("dragging the lane's top edge resizes it, and the height persists", async () => {
  localStorage.removeItem(VELOCITY_LANE_STORAGE_KEY);
  const { unmount } = await renderRoll();
  const handle = page.getByRole("separator", { name: "Resize velocity lane" });
  const box = (await handle.element()).getBoundingClientRect();
  const from = { x: box.left + 40, y: box.top + box.height / 2 };
  await drag(from, { x: from.x, y: from.y - 30 });
  await expect
    .poll(() => lane().getBoundingClientRect().height)
    .toBe(VELOCITY_LANE_DEFAULT_PX + 30);
  expect(localStorage.getItem(VELOCITY_LANE_STORAGE_KEY)).toBe(
    String(VELOCITY_LANE_DEFAULT_PX + 30),
  );
  // The notes' view keeps its height; the lane adds to the roll's.
  const scroller = lane().closest<HTMLElement>(".piano-roll__scroll");
  expect(scroller?.clientHeight).toBeGreaterThan(
    180 + VELOCITY_LANE_DEFAULT_PX,
  );

  unmount();
  await renderRoll();
  expect(lane().getBoundingClientRect().height).toBe(
    VELOCITY_LANE_DEFAULT_PX + 30,
  );
  localStorage.removeItem(VELOCITY_LANE_STORAGE_KEY);
});

test("the stems stay under their notes while the roll scrolls", async () => {
  await renderRoll([
    ...NOTES,
    { pitch: 62, start: 30, length: 1, velocity: 90 },
  ]);
  const scroller = lane().closest<HTMLElement>(".piano-roll__scroll");
  if (!scroller) {
    throw new Error("missing the roll's scroller");
  }
  scroller.scrollLeft = 3 * PIANO_ROLL_QUARTER_PX;
  scroller.scrollTop = 200;
  await expect.poll(() => scroller.scrollLeft).toBeGreaterThan(0);
  for (const index of [1, 2, 3]) {
    expect(
      Math.abs(
        stem(index).getBoundingClientRect().left -
          note(index).getBoundingClientRect().left,
      ),
    ).toBeLessThan(1.5);
  }
  // Docked: the lane stays along the scroller's bottom.
  expect(
    Math.abs(
      lane().getBoundingClientRect().bottom -
        scroller.getBoundingClientRect().bottom,
    ),
  ).toBeLessThan(scroller.offsetHeight - scroller.clientHeight + 2);
});

function midiProject(): ProjectState {
  const base = withTestPatternTrack(INITIAL_PROJECT_STATE);
  return {
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
        durationSeconds: (8 * 60) / base.bpm,
        trimStartSeconds: 0,
        notes: NOTES,
        tint: "#1c2340",
        accent: "#7ca1ff",
      },
    ],
    effects: addDefaultSynth(base.effects, "source-bassline", "bass-synth"),
  };
}

test(
  "a velocity drag in the editor is one undo step",
  async () => {
    let state: ProjectState | undefined;
    let status = "";
    // Tall enough for the whole lane under the FX panel's scrollbars, which
    // take room on Linux.
    await setViewport({ width: 1280, height: 960 });
    await renderEditor({
      project: midiProject(),
      onState: (next) => {
        state = next.project;
        status = next.status;
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
    // The FX panel scrolls down to the lane at this window size.
    lane().scrollIntoView({ block: "end" });
    expect(lane().getBoundingClientRect().bottom).toBeLessThanOrEqual(
      window.innerHeight,
    );
    // The FX panel's devices can still shift it as they finish laying out
    // (a scrollbar coming and going on Linux); drag once it holds still.
    await expect
      .poll(async () => {
        const top = lane().getBoundingClientRect().top;
        await new Promise((resolve) => setTimeout(resolve, 250));
        return lane().getBoundingClientRect().top === top;
      })
      .toBe(true);

    const left = lane().getBoundingClientRect().left;
    await drag(
      { x: left + 1, y: velocityY(50) },
      { x: left + 4 * PIANO_ROLL_QUARTER_PX + 1, y: velocityY(50) },
    );
    await expect
      .poll(() => notes()?.every((note) => Math.abs(note.velocity - 50) <= 2))
      .toBe(true);

    await undo();
    await expect.poll(() => notes()).toEqual(NOTES);
    expect(status).toBe(`Undid: ${midiHistoryLabels.setVelocity}.`);
  },
  EDITOR_TEST_TIMEOUT,
);
