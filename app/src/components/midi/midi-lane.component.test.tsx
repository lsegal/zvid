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
import {
  center,
  click,
  drag,
  menuItem,
  nextFrames,
  rightClick,
  undo,
} from "../../component-test/input.ts";
import { installHarness } from "../../harness";
import { DEFAULT_SYNTH_PARAMS, type MidiNote } from "../../midi-clip.ts";
import { defaultMidiTimeline } from "../../midi-clip-timeline.ts";
import { PIANO_ROLL_HIGH_PITCH } from "../../midi-piano-roll.ts";
import { DEFAULT_ARPEGGIATOR } from "../../note-generators.ts";
import { NEW_MIDI_CLIP_LABEL } from "../../source-clip-edits.ts";
import {
  PIANO_ROLL_QUARTER_PX,
  PIANO_ROLL_ROW_PX,
  PianoRoll,
} from "./PianoRoll";

// MIDI clips in source-track lanes (#1351): their piano-roll thumbnails,
// their track's Synth device, and the piano roll that edits the selected
// clip's notes, each edit one undo step. The source lane menu's Add MIDI
// Clip creates empty ones at the playhead (#1363, #1369).

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
  let status = "";
  await renderEditor({
    project: initial,
    onState: (next) => {
      state = next.project;
      status = next.status;
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
    status: () => status,
    notes: () =>
      project().sourceSpans.find((span) => span.id === "source-bassline")
        ?.notes,
    synth: () =>
      project().sourceTracks.find((track) => track.id === "bass")?.synth,
    arp: () =>
      project().sourceTracks.find((track) => track.id === "bass")
        ?.noteGenerators?.[0],
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

// Selects the Bass track by its name, so the FX panel shows its devices.
async function selectBass() {
  await expect.poll(bassRow).toBeTruthy();
  await userEvent.click(
    bassRow()?.querySelector("[data-source-track-label-id]") as HTMLElement,
  );
}

test(
  "MIDI clips draw piano-roll thumbnails, and track handles have no instrument button",
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

    // The test pattern's clip draws no notes.
    const videoSpan = document.querySelector(
      ".source-span:not(.source-span--midi)",
    );
    expect(videoSpan).toBeTruthy();
    expect(videoSpan?.querySelector("[data-midi-thumbnail]")).toBeNull();
    // The Synth device sits in the FX panel instead (#1369).
    expect(
      bassRow()?.querySelector('.track-label button[aria-label$=" synth"]'),
    ).toBeNull();
  },
  EDITOR_TEST_TIMEOUT,
);

test(
  "selecting the track shows its Synth device, whose edits are undoable",
  async () => {
    const { synth } = await open();
    await selectBass();
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

test(
  "the Arpeggiator device adds, sets, bypasses and removes the track's arpeggiator",
  async () => {
    const { arp } = await open();
    await selectBass();
    const device = page.getByRole("region", { name: "Bass arpeggiator" });
    await expect.element(device).toBeVisible();
    expect(arp()).toBeUndefined();

    await userEvent.click(
      device.getByRole("button", { name: "Add Arpeggiator" }),
    );
    await expect.poll(arp).toEqual(DEFAULT_ARPEGGIATOR);
    // It sits ahead of the Synth, which plays what it generates.
    const synthDevice = page.getByRole("region", { name: "Bass synth" });
    expect(
      device.element().compareDocumentPosition(synthDevice.element()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await userEvent.click(device.getByRole("button", { name: "1/8" }));
    await userEvent.click(device.getByRole("button", { name: "Up-Down" }));
    await userEvent.click(device.getByRole("button", { name: "3" }));
    await expect.poll(arp).toEqual({
      ...DEFAULT_ARPEGGIATOR,
      rate: 0.5,
      pattern: "up-down",
      octaves: 3,
    });
    await expect
      .element(device.getByRole("button", { name: "Up-Down" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(device.getByRole("button", { name: "1/16" }))
      .toHaveAttribute("aria-pressed", "false");

    await userEvent.click(
      device.getByRole("button", { name: "Bypass Arpeggiator" }),
    );
    await expect.poll(() => arp()?.enabled).toBe(false);
    await expect
      .element(device.getByRole("button", { name: "Enable Arpeggiator" }))
      .toHaveAttribute("aria-pressed", "false");
    await undo();
    await expect.poll(() => arp()?.enabled).toBe(true);
    await undo();
    await expect.poll(() => arp()?.octaves).toBe(1);

    await userEvent.click(
      device.getByRole("button", { name: "Remove Arpeggiator" }),
    );
    await expect.poll(arp).toBeUndefined();
    await expect
      .element(device.getByRole("button", { name: "Add Arpeggiator" }))
      .toBeVisible();
    await undo();
    await expect.poll(() => arp()?.pattern).toBe("up-down");
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
  "dragging a note's edges resizes it on the grid as one undo step each",
  async () => {
    const { notes, status } = await openPianoRoll();
    const note = noteButton("C4");
    if (!note) {
      throw new Error("missing C4 note");
    }
    const end = note.querySelector<HTMLElement>("[data-note-edge='end']");
    if (!end) {
      throw new Error("missing the C4 note's end edge");
    }
    expect(getComputedStyle(end).cursor).toBe("ew-resize");
    // Out a quarter and a bit, which snaps to a quarter longer.
    const from = center(end);
    await drag(from, {
      x: from.x + 1.1 * PIANO_ROLL_QUARTER_PX,
      y: from.y + 3 * PIANO_ROLL_ROW_PX,
    });
    await expect
      .poll(() => notes()?.[2])
      .toEqual({ pitch: 60, start: 4, length: 3, velocity: 100 });

    // Way in, which stops at a sixteenth.
    const shorter = center(end);
    await drag(shorter, {
      x: shorter.x - 6 * PIANO_ROLL_QUARTER_PX,
      y: shorter.y,
    });
    await expect.poll(() => notes()?.[2]?.length).toBe(0.25);

    await undo();
    await expect.poll(() => notes()?.[2]?.length).toBe(3);
    expect(status()).toBe("Undid: Resize Note.");
    await undo();
    await expect.poll(() => notes()).toEqual(NOTES);

    // The start edge moves the note's start and keeps its end.
    const start = noteButton("C4")?.querySelector<HTMLElement>(
      "[data-note-edge='start']",
    );
    if (!start) {
      throw new Error("missing the C4 note's start edge");
    }
    const startFrom = center(start);
    await drag(startFrom, {
      x: startFrom.x - PIANO_ROLL_QUARTER_PX,
      y: startFrom.y,
    });
    await expect
      .poll(() => notes()?.[2])
      .toEqual({ pitch: 60, start: 3, length: 3, velocity: 100 });
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
        timeline: defaultMidiTimeline(8),
        synth,
      }}
      onAudition={onAudition}
      onSetNotes={onSetNotes}
      onSetTimeline={() => {}}
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
  "Add MIDI Clip places an empty clip where the lane was right-clicked, up to the next clip, whose piano roll adds notes",
  async () => {
    const midi = midiProject();
    // The Bass track holds only its MIDI clip, moved to quarter 10.
    const { project, status } = await open({
      ...midi,
      sourceSpans: midi.sourceSpans.map((span) =>
        span.id === "source-bassline" ? { ...span, startQ: 10 } : span,
      ),
    });
    const bassSpans = () =>
      project().sourceSpans.filter((span) => span.sourceTrackId === "bass");
    const ahead = bassSpans()[0];
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
    const box = lane.getBoundingClientRect();
    const addMidiClipAt = async (q: number) => {
      await click(box.x + q * quarterPx, box.y + box.height / 2, {
        button: "right",
      });
      await userEvent.click(menuItem("Add MIDI Clip"));
    };

    // With the playhead parked at quarter 4 on the ruler, right-clicking
    // just past quarter 8 snaps there. The clip goes at the cursor, not the
    // playhead, and stops where the clip at quarter 10 begins, short of a
    // whole bar.
    const ruler = (
      document.querySelector(".ruler-row__content") as HTMLElement
    ).getBoundingClientRect();
    await click(box.x + 4 * quarterPx, ruler.y + 4);
    await addMidiClipAt(8.05);
    await expect.poll(() => bassSpans()).toHaveLength(2);
    const clip = bassSpans().find((span) => span.id !== ahead.id);
    if (!clip) {
      throw new Error("No MIDI clip was added");
    }
    expect(clip.notes).toEqual([]);
    expect(clip.startQ).toBe(8);
    expect((clip.durationSeconds * project().bpm) / 60).toBeCloseTo(2);
    expect(clip.label).toBe(NEW_MIDI_CLIP_LABEL);
    expect(bassSpans().find((span) => span.id === ahead.id)).toEqual(ahead);

    // It shows as a MIDI clip, selected with its piano roll open.
    const span = () =>
      document.querySelector<HTMLElement>(`[data-source-span-id="${clip.id}"]`);
    await expect.poll(() => span()?.textContent).toContain("MIDI · 0 notes");
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
      .poll(() => bassSpans().find((item) => item.id === clip.id)?.notes)
      .toEqual([{ pitch: 60, start: 1, length: 1, velocity: 100 }]);
    await expect
      .poll(() => span()?.querySelectorAll(".source-span__midi-note").length)
      .toBe(1);

    // Right-clicking just left of the new clip snaps to its start, so Add
    // MIDI Clip adds nothing and says why.
    await addMidiClipAt(7.9);
    await expect.poll(status).toMatch(/can't start inside another clip/);
    expect(bassSpans()).toHaveLength(2);

    // Adding the note and creating the clip are an undo step each.
    await undo();
    await expect
      .poll(() => bassSpans().find((item) => item.id === clip.id)?.notes)
      .toEqual([]);
    await undo();
    await expect.poll(() => bassSpans()).toEqual([ahead]);
  },
  EDITOR_TEST_TIMEOUT,
);
