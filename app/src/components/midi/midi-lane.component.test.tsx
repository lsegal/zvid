import { expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { INITIAL_PROJECT_STATE } from "../../app/constants.ts";
import type { ProjectState } from "../../app/types.ts";
import {
  EDITOR_TEST_TIMEOUT,
  Editor,
  renderEditor,
  withTestPatternTrack,
} from "../../component-test/editor.tsx";
import {
  center,
  click,
  drag,
  isVisible,
  menuItem,
  nextFrames,
  rightClick,
  undo,
} from "../../component-test/input.ts";
import { installHarness } from "../../harness";
import { DEFAULT_SYNTH_PARAMS, type MidiNote } from "../../midi-clip.ts";
import { PIANO_ROLL_HIGH_PITCH } from "../../midi-piano-roll.ts";
import { NEW_MIDI_CLIP_LABEL } from "../../source-clip-edits.ts";
import {
  PIANO_ROLL_QUARTER_PX,
  PIANO_ROLL_ROW_PX,
  PianoRoll,
} from "./PianoRoll";

// MIDI clips in source-track lanes (#1351): their piano-roll thumbnails,
// the track handle's instrument slot and Synth device, and the piano roll
// that edits the selected clip's notes, each edit one undo step. The source
// lane menu creates empty ones (#1363).

const NOTES: MidiNote[] = [
  { pitch: 48, start: 0, length: 1, velocity: 100 },
  { pitch: 55, start: 2, length: 1, velocity: 100 },
  { pitch: 60, start: 4, length: 2, velocity: 100 },
];

// The test pattern's track, then a Bass track with an eight-quarter MIDI
// clip of NOTES.
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

async function open(initial = midiProject()) {
  let state: ProjectState | undefined;
  await renderEditor({
    project: initial,
    onState: (next) => {
      state = next.project;
    },
  });
  const project = () => {
    if (!state) {
      throw new Error("The editor reported no state");
    }
    return state;
  };
  return {
    project,
    notes: () =>
      project().sourceSpans.find((span) => span.id === "source-bassline")
        ?.notes,
    synth: () =>
      project().sourceTracks.find((track) => track.id === "bass")?.synth,
  };
}

function midiSpan() {
  return document.querySelector<HTMLElement>(
    '[data-source-span-id="source-bassline"]',
  );
}

function bassRow() {
  return document.querySelector<HTMLElement>(
    '.track-row--source[data-source-track-id="bass"]',
  );
}

test(
  "MIDI clips draw piano-roll thumbnails and their track gets an instrument slot",
  async () => {
    await open();
    await expect.poll(midiSpan).toBeTruthy();
    const span = midiSpan() as HTMLElement;
    expect(span.querySelectorAll(".source-span__midi-note")).toHaveLength(3);
    expect(span.textContent).toContain("MIDI · 3 notes");
    // Higher notes sit higher up the thumbnail.
    const [low, , high] = [
      ...span.querySelectorAll(".source-span__midi-note"),
    ].map((note) => note.getBoundingClientRect());
    expect(high.y).toBeLessThan(low.y);
    expect(high.x).toBeGreaterThan(low.x);

    // The test pattern's clip draws no notes, and its track has no
    // instrument slot.
    const videoSpan = document.querySelector(
      ".source-span:not(.source-span--midi)",
    );
    expect(videoSpan).toBeTruthy();
    expect(videoSpan?.querySelector("[data-midi-thumbnail]")).toBeNull();
    expect(document.querySelectorAll(".track-label__instrument")).toHaveLength(
      1,
    );
    expect(bassRow()?.querySelector(".track-label__instrument")).toBeTruthy();
  },
  EDITOR_TEST_TIMEOUT,
);

test(
  "the instrument slot opens the track's Synth device, whose edits are undoable",
  async () => {
    const { synth } = await open();
    await userEvent.click(
      page.getByRole("button", { name: "Open Bass synth" }).element(),
    );
    const device = page.getByRole("region", { name: "Bass synth" });
    await expect.element(device).toBeVisible();

    await userEvent.click(device.getByRole("button", { name: "Square" }));
    await expect.poll(() => synth()?.wave).toBe("square");
    await expect
      .element(device.getByRole("button", { name: "Square" }))
      .toHaveAttribute("aria-pressed", "true");

    const cutoff = device.getByRole("slider", { name: "Cutoff" });
    (cutoff.element() as HTMLElement).focus();
    await userEvent.keyboard("{ArrowUp}");
    await expect
      .poll(() => synth()?.cutoff ?? DEFAULT_SYNTH_PARAMS.cutoff)
      .toBeGreaterThan(DEFAULT_SYNTH_PARAMS.cutoff);
    expect(synth()?.wave).toBe("square");

    await undo();
    await expect.poll(() => synth()?.cutoff).toBe(DEFAULT_SYNTH_PARAMS.cutoff);
    await undo();
    await expect.poll(() => synth()?.wave ?? "sawtooth").toBe("sawtooth");
  },
  EDITOR_TEST_TIMEOUT,
);

// The piano roll's grid, with the clip selected.
async function openPianoRoll() {
  const model = await open();
  await userEvent.click(midiSpan() as HTMLElement);
  await expect
    .element(page.getByRole("region", { name: "Bassline notes" }))
    .toBeVisible();
  const grid = document.querySelector<HTMLElement>("[data-piano-roll-grid]");
  if (!grid) {
    throw new Error("missing piano roll grid");
  }
  return { ...model, grid };
}

// The client point of `quarter` and `pitch` on the grid, inside the cell.
function cell(grid: HTMLElement, quarter: number, pitch: number) {
  const box = grid.getBoundingClientRect();
  return {
    x: box.x + quarter * PIANO_ROLL_QUARTER_PX + 4,
    y: box.y + (PIANO_ROLL_HIGH_PITCH - pitch) * PIANO_ROLL_ROW_PX + 5,
  };
}

function noteButton(pitch: string) {
  return document.querySelector<HTMLElement>(
    `.piano-roll__note[aria-label^="${pitch} "]`,
  );
}

test(
  "clicking the piano roll adds a note, and undo removes it",
  async () => {
    const { grid, notes } = await openPianoRoll();
    const point = cell(grid, 6, 52);
    await click(point.x, point.y);
    await expect.poll(() => notes()?.length).toBe(4);
    expect(notes()?.[3]).toEqual({
      pitch: 52,
      start: 6,
      length: 1,
      velocity: 100,
    });
    // The lane's thumbnail follows.
    await expect
      .poll(
        () => midiSpan()?.querySelectorAll(".source-span__midi-note").length,
      )
      .toBe(4);

    await undo();
    await expect.poll(() => notes()).toEqual(NOTES);
  },
  EDITOR_TEST_TIMEOUT,
);

test(
  "dragging a note moves it in time and pitch as one undo step",
  async () => {
    const { notes } = await openPianoRoll();
    const note = noteButton("G3");
    if (!note) {
      throw new Error("missing G3 note");
    }
    const from = center(note);
    await drag(from, {
      x: from.x + 2 * PIANO_ROLL_QUARTER_PX,
      y: from.y - PIANO_ROLL_ROW_PX,
    });
    await expect
      .poll(() => notes()?.find((candidate) => candidate.pitch === 56))
      .toEqual({ pitch: 56, start: 4, length: 1, velocity: 100 });
    expect(notes()?.some((candidate) => candidate.pitch === 55)).toBe(false);
    expect(notes()).toHaveLength(3);

    await undo();
    await expect.poll(() => notes()).toEqual(NOTES);
  },
  EDITOR_TEST_TIMEOUT,
);

test(
  "right-clicking a note deletes it, and undo restores it",
  async () => {
    const { notes } = await openPianoRoll();
    const note = noteButton("C3");
    if (!note) {
      throw new Error("missing C3 note");
    }
    await rightClick(note);
    await expect.poll(() => notes()).toEqual(NOTES.slice(1));
    // Deleting opens no menu.
    expect(document.querySelector("[role='menu']")).toBeNull();

    await undo();
    await expect.poll(() => notes()).toEqual(NOTES);
  },
  EDITOR_TEST_TIMEOUT,
);

test("clicking a note or a key auditions it through the track's synth", async () => {
  await installHarness();
  const onAudition = vi.fn();
  const onSetNotes = vi.fn();
  const synth = { ...DEFAULT_SYNTH_PARAMS, wave: "square" as const };
  await render(
    <PianoRoll
      collapsed={false}
      model={{
        spanId: "clip",
        label: "Bassline",
        accent: "#7ca1ff",
        notes: NOTES,
        trimStartQ: 0,
        lengthQ: 8,
        synth,
      }}
      onAudition={onAudition}
      onSetNotes={onSetNotes}
      onToggleCollapsed={() => {}}
    />,
  );
  await userEvent.click(page.getByRole("button", { name: "Play C4" }));
  expect(onAudition).toHaveBeenLastCalledWith(60, synth);

  const note = noteButton("G3") as HTMLElement;
  const point = center(note);
  await click(point.x, point.y);
  expect(onAudition).toHaveBeenLastCalledWith(55, synth);
  // A click that doesn't move the note edits nothing.
  await nextFrames();
  expect(onSetNotes).not.toHaveBeenCalled();
});

test(
  "narrow handles leave the instrument slot out for the track name",
  async () => {
    // The stored label width applies on load.
    localStorage.clear();
    localStorage.setItem("zvid-label-width", "120");
    await installHarness();
    await render(<Editor project={midiProject()} />);
    await expect
      .poll(() => document.querySelector(".timeline-canvas--narrow-labels"))
      .toBeTruthy();
    await expect.poll(bassRow).toBeTruthy();
    const label = bassRow()?.querySelector(
      ".track-label--source",
    ) as HTMLElement;
    const instrument = label.querySelector(".track-label__instrument");
    expect(instrument).toBeTruthy();
    expect(isVisible(instrument)).toBe(false);
    const [labelBox, nameBox, armBox] = [
      label,
      label.querySelector("[data-source-track-label-id]"),
      label.querySelector(".track-label__arm"),
    ].map((item) => {
      if (!item) {
        throw new Error("The track handle is missing a control");
      }
      return item.getBoundingClientRect();
    });
    expect(armBox.x + armBox.width).toBeLessThanOrEqual(
      labelBox.x + labelBox.width,
    );
    expect(nameBox.width).toBeGreaterThan(16);

    // Selecting the track still shows its Synth device.
    await userEvent.click(
      label.querySelector("[data-source-track-label-id]") as HTMLElement,
    );
    await expect
      .element(page.getByRole("region", { name: "Bass synth" }))
      .toBeVisible();
  },
  EDITOR_TEST_TIMEOUT,
);

test(
  "the source lane menu creates an empty MIDI clip whose piano roll adds notes",
  async () => {
    const midi = midiProject();
    // The Bass track, empty.
    const { project } = await open({
      ...midi,
      sourceSpans: midi.sourceSpans.filter(
        (span) => span.sourceTrackId !== "bass",
      ),
    });
    const bassSpans = () =>
      project().sourceSpans.filter((span) => span.sourceTrackId === "bass");
    await expect.poll(bassRow).toBeTruthy();
    const lane = bassRow()?.querySelector(
      ".track-row__content--source",
    ) as HTMLElement;
    lane.scrollIntoView({ block: "nearest" });
    // From the timeline's start, so quarter 8 shows past the track handles.
    const scroller = document.querySelector(".timeline-scroll") as HTMLElement;
    scroller.scrollLeft = 0;
    await nextFrames();

    // Quarters are as wide as the test pattern's clip says.
    const pattern = project().sourceSpans[0];
    const patternWidth = (
      document.querySelector(
        `[data-source-span-id="${pattern.id}"]`,
      ) as HTMLElement
    ).getBoundingClientRect().width;
    const quarterPx =
      patternWidth / ((pattern.durationSeconds * project().bpm) / 60);

    // Right-clicking just past quarter 8 places a bar at quarter 8.
    const box = lane.getBoundingClientRect();
    await click(box.x + 8.05 * quarterPx, box.y + box.height / 2, {
      button: "right",
    });
    await userEvent.click(menuItem("New MIDI Clip"));
    await expect.poll(() => bassSpans()).toHaveLength(1);
    const [clip] = bassSpans();
    expect(clip.notes).toEqual([]);
    expect(clip.startQ).toBe(8);
    expect((clip.durationSeconds * project().bpm) / 60).toBe(4);
    expect(clip.label).toBe(NEW_MIDI_CLIP_LABEL);

    // It shows as a MIDI clip, its track gets an instrument slot, and it is
    // selected with its piano roll open.
    const span = () =>
      document.querySelector<HTMLElement>(`[data-source-span-id="${clip.id}"]`);
    await expect.poll(() => span()?.textContent).toContain("MIDI · 0 notes");
    expect(bassRow()?.querySelector(".track-label__instrument")).toBeTruthy();
    await expect
      .element(
        page.getByRole("region", { name: `${NEW_MIDI_CLIP_LABEL} notes` }),
      )
      .toBeVisible();

    const grid = document.querySelector<HTMLElement>("[data-piano-roll-grid]");
    if (!grid) {
      throw new Error("missing piano roll grid");
    }
    const point = cell(grid, 1, 60);
    await click(point.x, point.y);
    await expect
      .poll(() => bassSpans()[0]?.notes)
      .toEqual([{ pitch: 60, start: 1, length: 1, velocity: 100 }]);
    await expect
      .poll(() => span()?.querySelectorAll(".source-span__midi-note").length)
      .toBe(1);

    // Adding the note and creating the clip are an undo step each.
    await undo();
    await expect.poll(() => bassSpans()[0]?.notes).toEqual([]);
    await undo();
    await expect.poll(() => bassSpans()).toHaveLength(0);
  },
  EDITOR_TEST_TIMEOUT,
);
