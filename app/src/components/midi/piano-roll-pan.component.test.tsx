import { useState } from "react";
import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  center,
  down,
  drag,
  move,
  nextFrames,
  rightClick,
  up,
} from "../../component-test/input.ts";
import { installHarness } from "../../harness";
import { DEFAULT_INSTRUMENT, type MidiNote } from "../../midi-clip.ts";
import {
  defaultMidiTimeline,
  type MidiClipTimeline,
} from "../../midi-clip-timeline.ts";
import { midiHistoryLabels } from "../../midi-editing.ts";
import { PianoRoll } from "./PianoRoll";

// Panning the piano roll like the main timeline (#1597): right-dragging the
// grid pans both ways, with the timeline's threshold and momentum, dragging
// the ruler pans left and right, and a right-click with no drag deletes the
// note under the pointer.

// A note far along, so the roll is much wider than its scroller.
const NOTES: MidiNote[] = [
  { pitch: 60, start: 12, length: 1, velocity: 100 },
  { pitch: 62, start: 60, length: 1, velocity: 100 },
];

// The momentum window needs the pointer still
// for this long before a release stops dead.
const SETTLE_MS = 150;

async function renderRoll() {
  await installHarness();
  const edits: { notes: readonly MidiNote[]; label: string }[] = [];
  const timelines: MidiClipTimeline[] = [];
  function Roll() {
    const [current, setCurrent] = useState<readonly MidiNote[]>(NOTES);
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
          lengthQ: 64,
          timeline: defaultMidiTimeline(64),
          instrument: DEFAULT_INSTRUMENT,
        }}
        onAudition={() => {}}
        onSetNotes={(_, next, label) => {
          edits.push({ notes: next, label });
          setCurrent(next);
        }}
        onSetTimeline={(_, next) => timelines.push(next)}
        onToggleCollapsed={() => {}}
      />
    );
  }
  const screen = await render(<Roll />);
  await expect
    .element(page.getByRole("region", { name: "Bassline notes" }))
    .toBeVisible();
  const scroller = document.querySelector<HTMLElement>(".piano-roll__scroll");
  const grid = document.querySelector<HTMLElement>("[data-piano-roll-grid]");
  const ruler = document.querySelector<HTMLElement>("[data-piano-roll-ruler]");
  if (!scroller || !grid || !ruler) {
    throw new Error("missing piano roll parts");
  }
  // Away from every edge, past the loop brace and with notes out of the way.
  scroller.scrollLeft = 900;
  scroller.scrollTop = 200;
  await nextFrames();
  return { edits, timelines, scroller, grid, ruler, unmount: screen.unmount };
}

// An empty point of the grid, mid scroller.
function emptyGridPoint(scroller: HTMLElement) {
  const box = scroller.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + 60 };
}

// A point of the ruler on neither a marker nor the loop brace.
function freeRulerPoint(scroller: HTMLElement, ruler: HTMLElement) {
  const box = ruler.getBoundingClientRect();
  const x = scroller.getBoundingClientRect().left + 120;
  const y = box.bottom - 3;
  expect(document.elementFromPoint(x, y)?.closest("[data-ruler-handle]")).toBe(
    null,
  );
  return { x, y };
}

// Drags with `button` and holds still before letting go, so no momentum
// follows.
async function settledDrag(
  from: { x: number; y: number },
  to: { x: number; y: number },
  button: "left" | "right",
) {
  await move(from.x, from.y);
  await down({ button });
  await move(to.x, to.y, { button, steps: 8 });
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  await up({ button });
  await nextFrames();
}

function noteMenu() {
  return document.querySelector("[role='menu']");
}

function notePitchButton(pitch: string) {
  const note = document.querySelector<HTMLElement>(
    `.piano-roll__note[aria-label^="${pitch} "]`,
  );
  if (!note) {
    throw new Error(`missing ${pitch} note`);
  }
  return note;
}

test("right-dragging the grid pans it 1:1 in both axes, editing nothing", async () => {
  const { edits, scroller } = await renderRoll();
  const from = emptyGridPoint(scroller);
  for (const [dx, dy] of [
    [-60, -40],
    [60, 40],
  ]) {
    const { scrollLeft, scrollTop } = scroller;
    await settledDrag(from, { x: from.x + dx, y: from.y + dy }, "right");
    expect(scroller.scrollLeft).toBe(scrollLeft - dx);
    expect(scroller.scrollTop).toBe(scrollTop - dy);
  }
  expect(edits).toEqual([]);
  expect(noteMenu()).toBeNull();
});

test("a right-drag starting on a note pans and keeps the note", async () => {
  const { edits, scroller } = await renderRoll();
  scroller.scrollLeft = 12 * 32 - 100;
  await nextFrames();
  const note = notePitchButton("C4");
  note.scrollIntoView({ block: "center", inline: "center" });
  await nextFrames();
  const from = center(note);
  const { scrollLeft } = scroller;
  await settledDrag(from, { x: from.x - 50, y: from.y }, "right");
  expect(scroller.scrollLeft).toBe(scrollLeft + 50);
  expect(edits).toEqual([]);
});

test("a fast right-drag carries on with momentum after release", async () => {
  const { scroller } = await renderRoll();
  const from = emptyGridPoint(scroller);
  await drag(from, { x: from.x - 120, y: from.y }, {
    button: "right",
    steps: 4,
  });
  const released = scroller.scrollLeft;
  await expect.poll(() => scroller.scrollLeft).toBeGreaterThan(released);
});

test("a right-click deletes the note under the pointer, in one undo step", async () => {
  const { edits } = await renderRoll();
  const note = notePitchButton("C4");
  note.scrollIntoView({ block: "center", inline: "center" });
  await rightClick(note);
  await expect.poll(() => edits.length).toBe(1);
  expect(edits[0]?.label).toBe(midiHistoryLabels.deleteNote);
  expect(edits[0]?.notes).toEqual([NOTES[1]]);
  await nextFrames();
  expect(noteMenu()).toBeNull();
});

test("a right press that stays under the threshold is still a click", async () => {
  const { edits, scroller } = await renderRoll();
  const note = notePitchButton("C4");
  note.scrollIntoView({ block: "center", inline: "center" });
  await nextFrames();
  const { scrollLeft, scrollTop } = scroller;
  const from = center(note);
  await settledDrag(from, { x: from.x + 3, y: from.y }, "right");
  expect(scroller.scrollLeft).toBe(scrollLeft);
  expect(scroller.scrollTop).toBe(scrollTop);
  expect(edits.map((edit) => edit.label)).toEqual([
    midiHistoryLabels.deleteNote,
  ]);
});

test("right-clicking empty grid does nothing", async () => {
  const { edits, scroller } = await renderRoll();
  const from = emptyGridPoint(scroller);
  await move(from.x, from.y);
  await down({ button: "right" });
  await up({ button: "right" });
  await nextFrames();
  expect(edits).toEqual([]);
  expect(noteMenu()).toBeNull();
});

test("a long press or the menu key still opens the note menu", async () => {
  const { edits } = await renderRoll();
  const note = notePitchButton("C4");
  note.scrollIntoView({ block: "center", inline: "center" });
  await nextFrames();
  const point = center(note);
  note.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
    }),
  );
  await expect.element(page.getByRole("menu")).toBeVisible();
  expect(edits).toEqual([]);
});

test("a left press on the grid still paints and doesn't pan", async () => {
  const { edits, scroller } = await renderRoll();
  const from = emptyGridPoint(scroller);
  const { scrollLeft, scrollTop } = scroller;
  await settledDrag(from, { x: from.x - 40, y: from.y }, "left");
  expect(edits[0]?.label).toBe(midiHistoryLabels.addNote);
  expect(scroller.scrollLeft).toBe(scrollLeft);
  expect(scroller.scrollTop).toBe(scrollTop);
});

test("dragging the ruler pans left and right only", async () => {
  const { edits, timelines, scroller, ruler } = await renderRoll();
  const from = freeRulerPoint(scroller, ruler);
  const { scrollLeft, scrollTop } = scroller;
  await settledDrag(from, { x: from.x - 70, y: from.y + 50 }, "left");
  expect(scroller.scrollLeft).toBe(scrollLeft + 70);
  expect(scroller.scrollTop).toBe(scrollTop);
  expect(edits).toEqual([]);
  expect(timelines).toEqual([]);
});

test("the ruler's markers keep their own drags rather than panning", async () => {
  const { timelines, scroller } = await renderRoll();
  scroller.scrollLeft = 0;
  await nextFrames();
  const start = document.querySelector(".piano-roll__marker--start");
  if (!start) {
    throw new Error("missing Start marker");
  }
  const from = center(start);
  await settledDrag(from, { x: from.x + 32, y: from.y }, "left");
  expect(scroller.scrollLeft).toBe(0);
  expect(timelines.at(-1)?.start).toBe(1);
});

test("right-dragging the ruler neither pans nor zooms", async () => {
  const { scroller, ruler, grid } = await renderRoll();
  const from = freeRulerPoint(scroller, ruler);
  const { scrollLeft } = scroller;
  const width = grid.offsetWidth;
  await settledDrag(from, { x: from.x - 70, y: from.y + 80 }, "right");
  expect(scroller.scrollLeft).toBe(scrollLeft);
  expect(grid.offsetWidth).toBe(width);
});
