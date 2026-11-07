import { useState } from "react";
import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
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

// The piano roll's drag gestures: middle-dragging the grid pans both ways, with
// the main timeline's threshold and momentum (#1597), right-dragging it deletes
// every note crossed and a right-click with no drag the note under the pointer
// (#1611). Dragging the ruler pans left and right, and right-dragging it up or
// down also zooms (#1611).

// A note far along, so the roll is much wider than its scroller.
const NOTES: MidiNote[] = [
  { pitch: 60, start: 12, length: 1, velocity: 100 },
  { pitch: 62, start: 60, length: 1, velocity: 100 },
];

// The momentum window needs the pointer still
// for this long before a release stops dead.
const SETTLE_MS = 150;

async function renderRoll(notes: readonly MidiNote[] = NOTES) {
  await installHarness();
  const edits: { notes: readonly MidiNote[]; label: string }[] = [];
  const timelines: MidiClipTimeline[] = [];
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
  button: "left" | "right" | "middle",
) {
  await move(from.x, from.y);
  await down({ button });
  await move(to.x, to.y, { steps: 8 });
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

test("middle-dragging the grid pans it 1:1 in both axes, editing nothing", async () => {
  const { edits, scroller } = await renderRoll();
  const from = emptyGridPoint(scroller);
  for (const [dx, dy] of [
    [-60, -40],
    [60, 40],
  ]) {
    const { scrollLeft, scrollTop } = scroller;
    await settledDrag(from, { x: from.x + dx, y: from.y + dy }, "middle");
    expect(scroller.scrollLeft).toBe(scrollLeft - dx);
    expect(scroller.scrollTop).toBe(scrollTop - dy);
  }
  expect(edits).toEqual([]);
  expect(noteMenu()).toBeNull();
});

test("a fast middle-drag carries on with momentum after release", async () => {
  const { scroller } = await renderRoll();
  const from = emptyGridPoint(scroller);
  await drag(
    from,
    { x: from.x - 120, y: from.y },
    {
      button: "middle",
      steps: 4,
    },
  );
  const released = scroller.scrollLeft;
  await expect.poll(() => scroller.scrollLeft).toBeGreaterThan(released);
});

// A run of C4s and a D4 out of the stroke's way.
const RUN: MidiNote[] = [
  { pitch: 60, start: 12, length: 1, velocity: 100 },
  { pitch: 60, start: 14, length: 1, velocity: 100 },
  { pitch: 60, start: 16, length: 1, velocity: 100 },
  { pitch: 62, start: 14, length: 1, velocity: 100 },
];

function runNote(start: number) {
  const note = document.querySelector<HTMLElement>(
    `.piano-roll__note[aria-label="C4 at beat ${start + 1}"]`,
  );
  if (!note) {
    throw new Error(`missing C4 at ${start}`);
  }
  return note;
}

async function revealRun(scroller: HTMLElement) {
  runNote(14).scrollIntoView({ block: "center", inline: "center" });
  await nextFrames();
  return { scrollLeft: scroller.scrollLeft, scrollTop: scroller.scrollTop };
}

test("right-dragging across notes deletes them in one undo step, and the view stays put", async () => {
  const { edits, scroller } = await renderRoll(RUN);
  const { scrollLeft, scrollTop } = await revealRun(scroller);
  const from = center(runNote(12));
  const to = center(runNote(16));
  await move(from.x, from.y);
  await down({ button: "right" });
  await move(center(runNote(14)).x, from.y, { steps: 4 });
  // Each note goes as the pointer crosses it, ahead of the undo step.
  expect(document.querySelectorAll(".piano-roll__note")).toHaveLength(2);
  expect(edits).toEqual([]);
  await move(to.x, to.y, { steps: 4 });
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  await up({ button: "right" });
  await nextFrames();
  expect(edits).toEqual([
    { notes: [RUN[3]], label: midiHistoryLabels.deleteNotes },
  ]);
  expect(scroller.scrollLeft).toBe(scrollLeft);
  expect(scroller.scrollTop).toBe(scrollTop);
  expect(noteMenu()).toBeNull();
});

test("an erase stroke can start on empty grid, and a fast one misses no note", async () => {
  const { edits, scroller } = await renderRoll(RUN);
  await revealRun(scroller);
  const c4 = center(runNote(14));
  const from = { x: c4.x - 3.5 * 32, y: c4.y };
  await move(from.x, from.y);
  await down({ button: "right" });
  await move(c4.x + 2.5 * 32, c4.y, { steps: 1 });
  await up({ button: "right" });
  await expect.poll(() => edits.length).toBe(1);
  expect(edits[0]?.notes).toEqual([RUN[3]]);
});

test("an erase stroke deletes just the crossed notes from the selection", async () => {
  const { edits, scroller } = await renderRoll(RUN);
  await revealRun(scroller);
  await move(center(runNote(12)).x, center(runNote(12)).y);
  await down();
  await up();
  const d4 = notePitchButton("D4");
  await move(center(d4).x, center(d4).y);
  await userEvent.keyboard("{Shift>}");
  await down();
  await up();
  await userEvent.keyboard("{/Shift}");
  await expect
    .element(notePitchButton("D4"))
    .toHaveAttribute("aria-pressed", "true");
  const from = center(runNote(12));
  await settledDrag(from, { x: from.x + 8, y: from.y }, "right");
  expect(edits[0]?.label).toBe(midiHistoryLabels.deleteNote);
  await expect
    .element(notePitchButton("D4"))
    .toHaveAttribute("aria-pressed", "true");
  expect(runNote(14).getAttribute("aria-pressed")).toBe("false");
});

test("a contextmenu that comes after the release is swallowed, wherever it lands", async () => {
  const { scroller } = await renderRoll(RUN);
  await revealRun(scroller);
  // Holds back the contextmenu of the press, as Windows does.
  const holdBack = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  window.addEventListener("contextmenu", holdBack, true);
  const from = center(runNote(14));
  await move(from.x, from.y);
  await down({ button: "right" });
  window.removeEventListener("contextmenu", holdBack, true);
  await up({ button: "right" });
  const menu = () =>
    document.body.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
  expect(menu()).toBe(false);
  expect(menu()).toBe(true);
  expect(noteMenu()).toBeNull();
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

test("a right press that barely moves deletes just the note under it", async () => {
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
  expect(edits[0]?.label).toBe(midiHistoryLabels.addNotes);
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

// A right-drag on the ruler, and how the roll drew the time under the pointer.
async function rightDragRuler(
  grid: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const quarterAt = (x: number, quarterPx: number) =>
    (x - grid.getBoundingClientRect().left) / quarterPx;
  const before = grid.offsetWidth;
  const anchorQ = quarterAt(from.x, 32);
  await settledDrag(from, to, "right");
  const scale = grid.offsetWidth / before;
  return { scale, anchorQ, shownQ: quarterAt(to.x, 32 * scale) };
}

test("right-dragging the ruler up zooms in around the pointer's time", async () => {
  const { edits, timelines, scroller, ruler, grid } = await renderRoll();
  const from = freeRulerPoint(scroller, ruler);
  const { scrollTop } = scroller;
  const { scale, anchorQ, shownQ } = await rightDragRuler(grid, from, {
    x: from.x,
    y: from.y - 100,
  });
  expect(scale).toBeCloseTo(Math.exp(0.004 * 75), 2);
  expect(shownQ).toBeCloseTo(anchorQ, 1);
  expect(ruler.offsetWidth).toBe(grid.offsetWidth);
  expect(scroller.scrollTop).toBe(scrollTop);
  expect(edits).toEqual([]);
  expect(timelines).toEqual([]);
});

test("right-dragging the ruler down zooms out around the pointer's time", async () => {
  const { scroller, ruler, grid } = await renderRoll();
  const from = freeRulerPoint(scroller, ruler);
  const { scale, anchorQ, shownQ } = await rightDragRuler(grid, from, {
    x: from.x,
    y: from.y + 100,
  });
  expect(scale).toBeCloseTo(Math.exp(-0.004 * 75), 2);
  expect(shownQ).toBeCloseTo(anchorQ, 1);
});

test("right-dragging the ruler sideways pans without zooming", async () => {
  const { scroller, ruler, grid } = await renderRoll();
  const from = freeRulerPoint(scroller, ruler);
  const { scrollLeft } = scroller;
  const width = grid.offsetWidth;
  await settledDrag(from, { x: from.x - 70, y: from.y + 10 }, "right");
  expect(scroller.scrollLeft).toBeCloseTo(scrollLeft + 70, 0);
  expect(grid.offsetWidth).toBe(width);
});

test("right-dragging the ruler's marker zooms rather than moving it", async () => {
  const { timelines, scroller, grid } = await renderRoll();
  scroller.scrollLeft = 0;
  await nextFrames();
  const start = document.querySelector(".piano-roll__marker--start");
  if (!start) {
    throw new Error("missing Start marker");
  }
  const from = center(start);
  const width = grid.offsetWidth;
  await settledDrag(from, { x: from.x, y: from.y - 100 }, "right");
  expect(grid.offsetWidth).toBeGreaterThan(width);
  expect(timelines).toEqual([]);
});

test("a right-click on the ruler opens no menu", async () => {
  const { ruler } = await renderRoll();
  const allowed = ruler.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
  );
  expect(allowed).toBe(false);
});

test("the zoomed roll draws and edits notes at their zoomed place", async () => {
  const { edits, scroller, ruler, grid } = await renderRoll();
  const from = freeRulerPoint(scroller, ruler);
  const { scale } = await rightDragRuler(grid, from, {
    x: from.x,
    y: from.y - 100,
  });
  const note = notePitchButton("C4");
  expect(note.offsetWidth).toBeCloseTo(32 * scale, 0);
  expect(note.offsetLeft).toBeCloseTo(12 * 32 * scale, 0);
  note.scrollIntoView({ block: "center", inline: "center" });
  await nextFrames();
  const box = note.getBoundingClientRect();
  await settledDrag(
    { x: box.right + 32 * scale * 2.5, y: box.top + 5 },
    { x: box.right + 32 * scale * 2.5, y: box.top + 5 },
    "left",
  );
  expect(edits[0]?.label).toBe(midiHistoryLabels.addNote);
  // Half a quarter or so past the note's own end, three quarters on.
  const added = edits[0]?.notes.find(
    (added) => added.pitch === 60 && added.start > 12,
  );
  expect(added?.start).toBeCloseTo(15.5, 0);
});
