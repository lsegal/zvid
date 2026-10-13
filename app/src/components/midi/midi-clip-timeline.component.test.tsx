import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { INITIAL_PROJECT_STATE } from "../../app/constants.ts";
import type { ProjectState } from "../../app/types.ts";
import {
  EDITOR_TEST_TIMEOUT,
  renderEditor,
  withTestPatternTrack,
} from "../../component-test/editor.tsx";
import { center, drag, undo } from "../../component-test/input.ts";
import type { MidiNote } from "../../midi-clip.ts";
import { PIANO_ROLL_QUARTER_PX } from "./PianoRoll";

// A MIDI clip's Length, loop brace and Start marker (#1370): the piano
// roll's ruler drags them, Clip properties edits them, the lane thumbnail
// plays them out, and every edit is one undo step.

const NOTES: MidiNote[] = [
  { pitch: 48, start: 0, length: 1, velocity: 100 },
  { pitch: 55, start: 2, length: 1, velocity: 100 },
];

// The test pattern's track, then a Bass track with an eight-quarter MIDI
// clip of NOTES that has never set its timeline.
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
  };
}

function midiSpan() {
  return document.querySelector<HTMLElement>(
    '[data-source-span-id="source-bassline"]',
  );
}

function thumbnailNotes() {
  return midiSpan()?.querySelectorAll(".source-span__midi-note").length;
}

// The editor with the clip selected and its piano roll and Clip properties
// open.
async function openClip() {
  let state: ProjectState | undefined;
  await renderEditor({
    project: midiProject(),
    onState: (next) => {
      state = next.project;
    },
  });
  await expect.poll(midiSpan).toBeTruthy();
  await userEvent.click(midiSpan() as HTMLElement);
  await expect
    .element(page.getByRole("region", { name: "Bassline notes" }))
    .toBeVisible();
  return {
    timeline: () =>
      state?.sourceSpans.find((span) => span.id === "source-bassline")
        ?.midiTimeline,
  };
}

function properties() {
  return page.getByRole("region", { name: "Bassline properties" });
}

function slider(name: string) {
  const element = document.querySelector<HTMLElement>(
    `.piano-roll__ruler [role="slider"][aria-label="${name}"]`,
  );
  if (!element) {
    throw new Error(`missing ${name} slider`);
  }
  return element;
}

test(
  "Clip properties sets a MIDI clip's Length and loop, which repeat to the clip's end",
  async () => {
    const { timeline } = await openClip();
    expect(thumbnailNotes()).toBe(2);
    const scope = properties();
    // A clip that never set its timeline is as long as its content, unlooped.
    await expect
      .element(scope.getByRole("button", { name: "Off" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(scope.getByRole("spinbutton", { name: "MIDI Length" }))
      .toHaveTextContent("2.0.0");

    // One bar long: the eight-quarter clip plays it twice.
    const length = scope.getByRole("spinbutton", { name: "MIDI Length" });
    await length.getByRole("button").click();
    await length.getByRole("textbox").fill("1.0.0");
    await userEvent.keyboard("{Enter}");
    await expect.poll(timeline).toEqual({
      length: 4,
      start: 0,
      loopStart: 0,
      loopEnd: 4,
      loop: false,
    });
    await expect.poll(thumbnailNotes).toBe(4);

    // Looping only the second half plays the first half once.
    await userEvent.click(scope.getByRole("button", { name: "On" }));
    await expect.poll(() => timeline()?.loop).toBe(true);
    const loopStart = scope.getByRole("spinbutton", { name: "Loop Start" });
    await loopStart.getByRole("button").click();
    await loopStart.getByRole("textbox").fill("1.3.1");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => timeline()?.loopStart).toBe(2);
    // Quarters 0 and 2, then 2 at 4 and 6.
    await expect.poll(thumbnailNotes).toBe(4);

    await undo();
    await expect.poll(() => timeline()?.loopStart).toBe(0);
    await undo();
    await expect.poll(() => timeline()?.loop).toBe(false);
    await undo();
    await expect.poll(timeline).toBeUndefined();
    await expect.poll(thumbnailNotes).toBe(2);
  },
  EDITOR_TEST_TIMEOUT,
);

test(
  "the piano roll's ruler drags the Start marker and the loop brace",
  async () => {
    const { timeline } = await openClip();
    const start = slider("Start marker");
    expect(start.getAttribute("aria-valuetext")).toBe("1.1.1");

    const from = center(start);
    await drag(from, { x: from.x + 2 * PIANO_ROLL_QUARTER_PX, y: from.y });
    await expect.poll(() => timeline()?.start).toBe(2);
    expect(slider("Start marker").getAttribute("aria-valuetext")).toBe("1.3.1");

    // Dragging the brace past the clip's Length lengthens it.
    const brace = document.querySelector<HTMLElement>(".piano-roll__loop");
    if (!brace) {
      throw new Error("missing loop brace");
    }
    const box = brace.getBoundingClientRect();
    const grab = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await drag(grab, { x: grab.x + 4 * PIANO_ROLL_QUARTER_PX, y: grab.y });
    await expect.poll(timeline).toEqual({
      length: 12,
      start: 2,
      loopStart: 4,
      loopEnd: 12,
      loop: false,
    });

    // The arrow keys step a marker a sixteenth.
    slider("Loop end").focus();
    await userEvent.keyboard("{ArrowLeft}");
    await expect.poll(() => timeline()?.loopEnd).toBe(11.75);

    await undo();
    await expect.poll(() => timeline()?.loopEnd).toBe(12);
    await undo();
    await expect.poll(() => timeline()?.loopStart).toBe(0);
    await undo();
    await expect.poll(timeline).toBeUndefined();
  },
  EDITOR_TEST_TIMEOUT,
);
