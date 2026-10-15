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
import { addFromMenu } from "../../component-test/fx-actions.ts";
import {
  center,
  click,
  drag,
  menuItem,
  nextFrames,
  pressMod,
  rightClick,
  undo,
} from "../../component-test/input.ts";
import { sourceClipEffectTrackId } from "../../fx-stack.ts";
import { installHarness } from "../../harness";
import {
  DEFAULT_GRANULAR_PARAMS,
  DEFAULT_INSTRUMENT,
  DEFAULT_SYNTH_PARAMS,
  type MidiInstrument,
  type MidiNote,
} from "../../midi-clip.ts";
import {
  defaultMidiTimeline,
  type MidiClipTimeline,
} from "../../midi-clip-timeline.ts";
import { addDefaultSynth, midiChainOf } from "../../midi-effects.ts";
import { PIANO_ROLL_HIGH_PITCH } from "../../midi-piano-roll.ts";
import { DEFAULT_ARPEGGIATOR } from "../../note-generators.ts";
import { setNoteClipboard } from "../../piano-roll-actions.ts";
import { createPlayheadSignal } from "../../playhead-signal.ts";
import { NEW_MIDI_CLIP_LABEL } from "../../source-clip-edits.ts";
import { FxModulationClockContext } from "../fx/modulation-clock";
import {
  PIANO_ROLL_QUARTER_PX,
  PIANO_ROLL_ROW_PX,
  PianoRoll,
} from "./PianoRoll";

// MIDI clips in source-track lanes (#1351): their piano-roll thumbnails,
// the Synth and Arpeggiator MIDI effects on their own stacks (#1386), and
// the piano roll that edits the selected clip's notes, each edit one undo
// step. The source lane menu's Add MIDI Clip creates empty ones at the
// playhead (#1363, #1369), with a Synth.

const NOTES: MidiNote[] = [
  { pitch: 48, start: 0, length: 1, velocity: 100 },
  { pitch: 55, start: 2, length: 1, velocity: 100 },
  { pitch: 60, start: 4, length: 2, velocity: 100 },
];

// The test pattern's track, then a Bass track with an eight-quarter MIDI
// clip of NOTES, played by a default Synth.
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
    // What the clip's MIDI effects play.
    chain: () =>
      midiChainOf(
        project().effects.filter(
          (effect) =>
            effect.trackId === sourceClipEffectTrackId("source-bassline"),
        ),
      ),
    stackNames: (spanId = "source-bassline") =>
      project()
        .effects.filter(
          (effect) => effect.trackId === sourceClipEffectTrackId(spanId),
        )
        .map((effect) => effect.effectName),
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
  "MIDI clips draw piano-roll thumbnails, and track handles have no instrument button",
  async () => {
    // Without an instrument, the clip has no performance to draw instead.
    const project = midiProject();
    await open({
      ...project,
      effects: project.effects.filter(
        (effect) =>
          effect.trackId !== sourceClipEffectTrackId("source-bassline"),
      ),
    });
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
  "a MIDI clip draws its performance's waveform once it renders, and its notes without an instrument",
  async () => {
    await open();
    await expect.poll(midiSpan).toBeTruthy();
    const waveform = () =>
      midiSpan()?.querySelector("canvas.source-span__waveform") ?? null;
    await expect.poll(waveform).toBeTruthy();
    expect(midiSpan()?.querySelector("[data-midi-thumbnail]")).toBeNull();
    expect(midiSpan()?.textContent).toContain("MIDI · 3 notes");

    // Bypassing its only Synth leaves nothing to render: the notes return.
    await selectBassline();
    await userEvent.click(page.getByRole("button", { name: "Bypass Synth" }));
    await expect
      .poll(
        () => midiSpan()?.querySelectorAll(".source-span__midi-note").length,
      )
      .toBe(3);
    expect(waveform()).toBeNull();
  },
  EDITOR_TEST_TIMEOUT,
);

// Selects the Bassline clip, so the FX panel shows its stack.
async function selectBassline() {
  await expect.poll(midiSpan).toBeTruthy();
  await userEvent.click(midiSpan() as HTMLElement);
  await expect
    .element(page.getByRole("region", { name: "Bassline notes" }))
    .toBeVisible();
}

test(
  "a MIDI clip's Synth is an effect on its own stack, whose edits are undoable",
  async () => {
    const { chain } = await open();
    const synthOf = () => {
      const instrument = chain()?.instrument;
      return instrument?.kind === "synth" ? instrument.params : undefined;
    };
    await selectBassline();
    const device = page.getByRole("region", { name: "Synth", exact: true });
    await expect.element(device).toBeVisible();
    await expect
      .element(device.getByRole("img", { name: "MIDI effect" }))
      .toBeVisible();

    const wave = device.getByRole("group", { name: "Wave" });
    await userEvent.click(wave.getByRole("button", { name: "Square" }));
    await expect.poll(() => synthOf()?.wave).toBe("square");
    await expect
      .element(wave.getByRole("button", { name: "Square" }))
      .toHaveAttribute("aria-pressed", "true");

    const cutoff = device.getByRole("slider", { name: "Cutoff" });
    (cutoff.element() as HTMLElement).focus();
    await userEvent.keyboard("{ArrowUp}");
    await expect
      .poll(() => synthOf()?.cutoff)
      .toBeGreaterThan(DEFAULT_SYNTH_PARAMS.cutoff);
    expect(synthOf()?.wave).toBe("square");

    await undo();
    await expect
      .poll(() => synthOf()?.cutoff)
      .toBe(DEFAULT_SYNTH_PARAMS.cutoff);
    await undo();
    await expect.poll(() => synthOf()?.wave).toBe("sawtooth");

    // Bypassing its only Synth leaves the clip nothing to play through.
    await userEvent.click(device.getByRole("button", { name: "Bypass Synth" }));
    await expect.poll(chain).toBeUndefined();
  },
  EDITOR_TEST_TIMEOUT,
);

test(
  "only a MIDI clip's add menu offers the MIDI group, whose Arpeggiator feeds the Synth",
  async () => {
    const { chain, stackNames } = await open();
    await selectBassline();
    expect(chain()?.generators).toEqual([]);

    // The clip's menu lists the MIDI effects under their own heading.
    await userEvent.click(
      page.getByRole("button", { name: "Add device to this clip" }),
    );
    const menu = page.getByRole("menu");
    await expect
      .element(menu.getByRole("group", { name: "MIDI" }))
      .toBeVisible();
    await expect
      .element(menu.getByRole("group", { name: "Audio" }))
      .toBeVisible();
    expect(menu.getByRole("group", { name: "Video" }).elements()).toHaveLength(
      0,
    );
    await userEvent.keyboard("{Escape}");

    // The track's menu offers none.
    await userEvent.click(
      page.getByRole("button", { name: "Add device to this track" }),
    );
    await expect.element(page.getByRole("menu")).toBeVisible();
    expect(
      page
        .getByRole("menu")
        .getByRole("menuitem", { name: "MIDI", exact: true })
        .elements(),
    ).toHaveLength(0);
    await userEvent.keyboard("{Escape}");

    await addFromMenu(
      "Add device to this clip",
      "MIDI",
      /^Arpeggiator/,
      "MIDI",
    );
    await expect.poll(() => chain()?.generators).toEqual([DEFAULT_ARPEGGIATOR]);
    expect(stackNames()).toEqual(["Synth", "Arpeggiator"]);

    const arp = page.getByRole("region", { name: "Arpeggiator", exact: true });
    await userEvent.click(
      arp.getByRole("group", { name: "Rate" }).getByRole("button", {
        name: "1/8",
      }),
    );
    await userEvent.click(
      arp.getByRole("group", { name: "Pattern" }).getByRole("button", {
        name: "Up-Down",
      }),
    );
    await expect
      .poll(() => chain()?.generators)
      .toEqual([{ ...DEFAULT_ARPEGGIATOR, rate: 0.5, pattern: "up-down" }]);

    await undo();
    await undo();
    await expect.poll(() => chain()?.generators).toEqual([DEFAULT_ARPEGGIATOR]);
    await undo();
    await expect.poll(() => stackNames()).toEqual(["Synth"]);
  },
  EDITOR_TEST_TIMEOUT,
);

test(
  "a MIDI clip plays through its first enabled instrument, a Synth or a Granular",
  async () => {
    const { chain, stackNames } = await open();
    await selectBassline();
    await addFromMenu("Add device to this clip", "MIDI", /^Granular/, "MIDI");
    await expect.poll(() => stackNames()).toEqual(["Synth", "Granular"]);
    const granular = page.getByRole("region", {
      name: "Granular",
      exact: true,
    });
    await expect
      .element(granular.getByRole("slider", { name: "Grain Size" }))
      .toBeVisible();
    // The Synth comes first, so it still plays.
    expect(chain()?.instrument.kind).toBe("synth");

    // Bypassed, it leaves the Granular to play, whose edits it hears.
    await userEvent.click(page.getByRole("button", { name: "Bypass Synth" }));
    await expect.poll(() => chain()?.instrument.kind).toBe("granular");
    const density = granular.getByRole("slider", { name: "Density" });
    (density.element() as HTMLElement).focus();
    await userEvent.keyboard("{ArrowUp}");
    await expect
      .poll(() => {
        const instrument = chain()?.instrument;
        return instrument?.kind === "granular" ? instrument.params.density : 0;
      })
      .toBeGreaterThan(DEFAULT_GRANULAR_PARAMS.density);
  },
  EDITOR_TEST_TIMEOUT,
);

test(
  "other clips' add menus offer no MIDI effects",
  async () => {
    await open();
    const videoSpan = document.querySelector<HTMLElement>(
      ".source-span:not(.source-span--midi)",
    );
    await userEvent.click(videoSpan as HTMLElement);
    await userEvent.click(
      page.getByRole("button", { name: "Add device to this clip" }),
    );
    await expect.element(page.getByRole("menu")).toBeVisible();
    expect(
      page
        .getByRole("menu")
        .getByRole("menuitem", { name: "MIDI", exact: true })
        .elements(),
    ).toHaveLength(0);
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
  "the piano roll's header carries no gesture hint bar (#1405)",
  async () => {
    await openPianoRoll();
    const header = page
      .getByRole("region", { name: "Bassline notes" })
      .element()
      .querySelector("header");
    expect(header?.textContent?.trim()).toBe("Notes");
  },
  EDITOR_TEST_TIMEOUT,
);

test(
  "clicking the piano roll adds a note, and undo removes it",
  async () => {
    const { grid, notes } = await openPianoRoll();
    // The clip's waveform, as drawn.
    const drawn = () =>
      midiSpan()
        ?.querySelector<HTMLCanvasElement>("canvas.source-span__waveform")
        ?.toDataURL();
    await expect.poll(drawn).toBeTruthy();
    const before = drawn();
    const point = cell(grid, 6, 52);
    await click(point.x, point.y);
    await expect.poll(() => notes()?.length).toBe(4);
    expect(notes()?.[3]).toEqual({
      pitch: 52,
      start: 6,
      length: 1,
      velocity: 100,
    });
    // The lane's clip follows: its waveform renders again, sounding the new
    // note where it was silent.
    await expect.poll(() => midiSpan()?.textContent).toContain("4 notes");
    await expect
      .poll(() => {
        const after = drawn();
        return Boolean(after) && after !== before;
      })
      .toBe(true);

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

// The notes the piano roll shows selected, by label.
function selectedNotes() {
  return [
    ...document.querySelectorAll<HTMLElement>(".piano-roll__note--selected"),
  ].map((note) => note.getAttribute("aria-label"));
}

function requireNote(pitch: string) {
  const note = noteButton(pitch);
  if (!note) {
    throw new Error(`missing ${pitch} note`);
  }
  return note;
}

// An item of the open note menu, whose name ends with its shortcut; the
// app's own menus have items of the same names.
const noteMenuItem = (name: string) =>
  page
    .getByRole("menu")
    .getByRole("menuitem", { name: new RegExp(`^${name}(\\s|$)`) });

const clickNote = async (pitch: string, modifiers?: ["Shift"]) => {
  const point = center(requireNote(pitch));
  await click(point.x, point.y, modifiers ? { modifiers } : undefined);
};

test(
  "right-clicking a note opens its action menu, with inapplicable items disabled (#1397)",
  async () => {
    setNoteClipboard(undefined);
    const { grid, notes, status } = await openPianoRoll();
    await rightClick(requireNote("C3"));
    await expect.element(page.getByRole("menu")).toBeVisible();
    // It selects the note instead of deleting it.
    expect(notes()).toEqual(NOTES);
    expect(selectedNotes()).toEqual(["C3 at beat 1"]);
    const disabled = () =>
      page
        .getByRole("menu")
        .getByRole("menuitem")
        .elements()
        .filter((item) => item.getAttribute("aria-disabled") === "true")
        .map((item) => item.textContent);
    expect(
      page
        .getByRole("menu")
        .getByRole("menuitem")
        .elements()
        .map((item) => item.querySelector(".context-menu__label")?.textContent),
    ).toEqual([
      "Nudge Left",
      "Nudge Right",
      "Nudge Fine Left",
      "Nudge Fine Right",
      "Pitch Up",
      "Pitch Down",
      "Duplicate",
      "Cut",
      "Copy",
      "Paste",
      "Delete",
    ]);
    // The clipboard is empty.
    expect(disabled()).toHaveLength(1);
    await expect
      .element(noteMenuItem("Paste"))
      .toHaveAttribute("aria-disabled", "true");

    await noteMenuItem("Pitch Up").click();
    await expect
      .poll(() => notes()?.[0])
      .toEqual({ pitch: 49, start: 0, length: 1, velocity: 100 });
    expect(document.querySelector("[role='menu']")).toBeNull();
    await undo();
    await expect.poll(() => notes()).toEqual(NOTES);
    expect(status()).toBe("Undid: Transpose Notes.");

    // Copy, then right-click empty grid with nothing selected: only Paste.
    await rightClick(requireNote("G3"));
    await noteMenuItem("Copy").click();
    await userEvent.keyboard("{Escape}");
    await expect.poll(selectedNotes).toEqual([]);
    const empty = cell(grid, 6, 52);
    await click(empty.x, empty.y, { button: "right" });
    await expect.element(page.getByRole("menu")).toBeVisible();
    expect(disabled()).toHaveLength(10);
    await expect
      .element(noteMenuItem("Paste"))
      .not.toHaveAttribute("aria-disabled", "true");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.querySelector("[role='menu']")).toBeNull();
    expect(notes()).toEqual(NOTES);

    await rightClick(requireNote("C4"));
    await noteMenuItem("Delete").click();
    await expect.poll(() => notes()).toEqual(NOTES.slice(0, 2));
    await undo();
    await expect.poll(() => notes()).toEqual(NOTES);
  },
  EDITOR_TEST_TIMEOUT,
);

test(
  "the arrows nudge and transpose the selected notes, one undo step each (#1397)",
  async () => {
    const { notes, status } = await openPianoRoll();
    await clickNote("C3");
    await clickNote("G3", ["Shift"]);
    // A snap right, then half a snap more.
    await userEvent.keyboard("{ArrowRight}");
    await expect.poll(() => notes()?.[0]?.start).toBe(0.25);
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
    await expect
      .poll(() => notes()?.slice(0, 2))
      .toEqual([
        { pitch: 48, start: 0.375, length: 1, velocity: 100 },
        { pitch: 55, start: 2.375, length: 1, velocity: 100 },
      ]);
    // The moved notes stay selected.
    expect(selectedNotes()).toEqual(["C3 at beat 1.38", "G3 at beat 3.38"]);
    // Left stops at the clip's start, keeping the notes' spacing.
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    await expect.poll(() => notes()?.[0]?.start).toBe(0);
    expect(notes()?.[1]?.start).toBe(2);
    await userEvent.keyboard("{ArrowUp}{ArrowUp}{ArrowDown}");
    await expect
      .poll(() =>
        notes()
          ?.slice(0, 2)
          .map((note) => note.pitch),
      )
      .toEqual([49, 56]);

    await undo();
    await expect.poll(() => notes()?.[0]?.pitch).toBe(50);
    expect(status()).toBe("Undid: Transpose Notes.");
    await undo();
    await undo();
    await undo();
    await expect.poll(() => notes()?.[0]?.start).toBe(0.125);
    expect(status()).toBe("Undid: Nudge Notes.");
  },
  EDITOR_TEST_TIMEOUT,
);

test(
  "Cmd/Ctrl+D duplicates the selection right after itself, selecting the copies (#1397)",
  async () => {
    const { notes, status } = await openPianoRoll();
    await clickNote("C3");
    await clickNote("G3", ["Shift"]);
    await pressMod("d");
    // The selection spans quarters 0 to 3, so the copies start at 3.
    await expect
      .poll(() => notes())
      .toEqual([
        NOTES[0],
        NOTES[1],
        { pitch: 48, start: 3, length: 1, velocity: 100 },
        NOTES[2],
        { pitch: 55, start: 5, length: 1, velocity: 100 },
      ]);
    expect(selectedNotes()).toEqual(["C3 at beat 4", "G3 at beat 6"]);
    await undo();
    await expect.poll(() => notes()).toEqual(NOTES);
    expect(status()).toBe("Undid: Duplicate Notes.");
  },
  EDITOR_TEST_TIMEOUT,
);

test(
  "Cmd/Ctrl+X, C and V cut, copy and paste notes at the playhead (#1397)",
  async () => {
    setNoteClipboard(undefined);
    const { notes, status } = await openPianoRoll();
    // With the playhead at the clip's start, the copy lands at quarter 0.
    await clickNote("G3");
    await pressMod("c");
    expect(notes()).toEqual(NOTES);
    await pressMod("v");
    await expect
      .poll(() => notes())
      .toEqual([
        NOTES[0],
        { pitch: 55, start: 0, length: 1, velocity: 100 },
        NOTES[1],
        NOTES[2],
      ]);
    expect(selectedNotes()).toEqual(["G3 at beat 1"]);
    await undo();
    await expect.poll(() => notes()).toEqual(NOTES);
    expect(status()).toBe("Undid: Paste Notes.");

    await clickNote("C4");
    await pressMod("x");
    await expect.poll(() => notes()).toEqual(NOTES.slice(0, 2));
    await pressMod("v");
    await expect
      .poll(() => notes())
      .toEqual([
        NOTES[0],
        { pitch: 60, start: 0, length: 2, velocity: 100 },
        NOTES[1],
      ]);
    await undo();
    await expect.poll(() => notes()).toEqual(NOTES.slice(0, 2));
    await undo();
    await expect.poll(() => notes()).toEqual(NOTES);
    expect(status()).toBe("Undid: Cut Notes.");
  },
  EDITOR_TEST_TIMEOUT,
);

test(
  "clicking notes selects them, Escape clears, and Delete removes them (#1394)",
  async () => {
    const { notes, status } = await openPianoRoll();
    const selected = () =>
      [
        ...document.querySelectorAll<HTMLElement>(
          ".piano-roll__note--selected",
        ),
      ].map((note) => note.getAttribute("aria-label"));
    const c3 = noteButton("C3");
    const g3 = noteButton("G3");
    if (!c3 || !g3) {
      throw new Error("missing C3 or G3 note");
    }
    await click(center(c3).x, center(c3).y);
    await expect.poll(selected).toEqual(["C3 at beat 1"]);
    expect(c3.getAttribute("aria-pressed")).toBe("true");
    // Escape clears the selection and deletes nothing.
    await userEvent.keyboard("{Escape}");
    await expect.poll(selected).toEqual([]);
    expect(notes()).toEqual(NOTES);

    // Shift-click adds to the selection; Delete removes both in one step.
    await click(center(c3).x, center(c3).y);
    await click(center(g3).x, center(g3).y, { modifiers: ["Shift"] });
    await expect.poll(selected).toEqual(["C3 at beat 1", "G3 at beat 3"]);
    await userEvent.keyboard("{Delete}");
    await expect.poll(() => notes()).toEqual(NOTES.slice(2));
    await undo();
    await expect.poll(() => notes()).toEqual(NOTES);
    expect(status()).toBe("Undid: Delete Notes.");

    // Backspace deletes a single selected note.
    const c4 = noteButton("C4");
    if (!c4) {
      throw new Error("missing C4 note");
    }
    await click(center(c4).x, center(c4).y);
    await userEvent.keyboard("{Backspace}");
    await expect.poll(() => notes()).toEqual(NOTES.slice(0, 2));
  },
  EDITOR_TEST_TIMEOUT,
);

test(
  "Cmd/Ctrl-dragging a note duplicates it, trimming the note it lands on (#1394)",
  async () => {
    const { grid, notes, status } = await openPianoRoll();
    const c4 = noteButton("C4");
    if (!c4) {
      throw new Error("missing C4 note");
    }
    // A copy of the half-note C4 a quarter later covers the original's
    // second quarter, so the original keeps its first.
    const from = center(c4);
    await drag(
      from,
      { x: from.x + PIANO_ROLL_QUARTER_PX, y: from.y },
      { modifiers: ["Meta"] },
    );
    await expect
      .poll(() => notes())
      .toEqual([
        ...NOTES.slice(0, 2),
        { pitch: 60, start: 4, length: 1, velocity: 100 },
        { pitch: 60, start: 5, length: 2, velocity: 100 },
      ]);
    await undo();
    await expect.poll(() => notes()).toEqual(NOTES);
    expect(status()).toBe("Undid: Duplicate Note.");

    // Moving a note fully over another of its pitch removes that one.
    const point = cell(grid, 0, 55);
    await click(point.x, point.y);
    await expect.poll(() => notes()?.length).toBe(4);
    const g3 = document.querySelector<HTMLElement>(
      '.piano-roll__note[aria-label="G3 at beat 3"]',
    );
    if (!g3) {
      throw new Error("missing the G3 note at beat 3");
    }
    const g3From = center(g3);
    await drag(g3From, {
      x: g3From.x - 2 * PIANO_ROLL_QUARTER_PX,
      y: g3From.y,
    });
    await expect
      .poll(() => notes())
      .toEqual([NOTES[0], { ...NOTES[1], start: 0 }, NOTES[2]]);
  },
  EDITOR_TEST_TIMEOUT,
);

test("clicking a note or a key auditions it through the track's synth", async () => {
  await installHarness();
  const onAudition = vi.fn();
  const onSetNotes = vi.fn();
  const synth: MidiInstrument = {
    kind: "synth",
    params: { ...DEFAULT_SYNTH_PARAMS, wave: "square" },
  };
  await render(
    <PianoRoll
      collapsed={false}
      model={{
        spanId: "clip",
        label: "Bassline",
        accent: "#7ca1ff",
        notes: NOTES,
        startQ: 0,
        trimStartQ: 0,
        lengthQ: 8,
        timeline: defaultMidiTimeline(8),
        instrument: synth,
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

test("the piano roll's read-only playhead follows the note the clip sounds", async () => {
  await installHarness();
  const signal = createPlayheadSignal(0);
  const onSetNotes = vi.fn();
  // The clip starts at quarter 10, a quarter into its notes, and plays
  // Start (quarter 4) to its loop end (6), then its loop from 1 to 6.
  const timeline: MidiClipTimeline = {
    length: 8,
    start: 4,
    loopStart: 1,
    loopEnd: 6,
    loop: true,
  };
  await render(
    <FxModulationClockContext.Provider
      value={{
        signal,
        bpm: 120,
        signature: { numerator: 4, denominator: 4 },
        isPlaying: true,
      }}
    >
      <PianoRoll
        collapsed={false}
        model={{
          spanId: "clip",
          label: "Bassline",
          accent: "#7ca1ff",
          notes: NOTES,
          startQ: 10,
          trimStartQ: 1,
          lengthQ: 8,
          timeline,
          instrument: DEFAULT_INSTRUMENT,
        }}
        onAudition={() => {}}
        onSetNotes={onSetNotes}
        onSetTimeline={() => {}}
        onToggleCollapsed={() => {}}
      />
    </FxModulationClockContext.Provider>,
  );
  const grid = document.querySelector<HTMLElement>(
    "[data-piano-roll-grid]",
  ) as HTMLElement;
  const playhead = () =>
    document.querySelector<HTMLElement>("[data-piano-roll-playhead]");
  // The line's center, in quarters across the grid.
  const playheadQ = () => {
    const line = playhead()?.getBoundingClientRect();
    return line
      ? (line.x + line.width / 2 - grid.getBoundingClientRect().x) /
          PIANO_ROLL_QUARTER_PX
      : undefined;
  };

  // Before the clip, it's hidden.
  expect(playhead()).toBeNull();
  // At the clip's start, a quarter into its first pass, it's past Start.
  signal.set(10);
  await expect.poll(playheadQ).toBe(5);
  signal.set(10.5);
  await expect.poll(playheadQ).toBe(5.5);
  // Past the first pass, it wraps around the loop.
  signal.set(11);
  await expect.poll(playheadQ).toBe(1);
  signal.set(12.25);
  await expect.poll(playheadQ).toBe(2.25);
  signal.set(16);
  await expect.poll(playheadQ).toBe(1);
  // Past the clip's window, it's hidden again.
  signal.set(18);
  await expect.poll(playhead).toBeNull();

  // It has no handle and takes no pointer input: a click on it adds a note.
  signal.set(10);
  await expect.poll(playhead).not.toBeNull();
  expect(getComputedStyle(playhead() as HTMLElement, "::before").content).toBe(
    "none",
  );
  const line = (playhead() as HTMLElement).getBoundingClientRect();
  await click(line.x + line.width / 2, cell(grid, 0, 52).y);
  expect(onSetNotes).toHaveBeenCalledTimes(1);
});

test(
  "Add MIDI Clip places an empty clip where the lane was right-clicked, up to the next clip, whose piano roll adds notes",
  async () => {
    const midi = midiProject();
    // The Bass track holds only its MIDI clip, moved to quarter 10.
    const { project, status, stackNames } = await open({
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
    // It plays through a default Synth, with no Arpeggiator, and its Gain.
    expect(stackNames(clip.id)).toEqual(["Synth", "Gain"]);

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
    // Its note plays through the Synth, so the clip draws its waveform.
    await expect.poll(() => span()?.textContent).toContain("MIDI · 1 note");
    await expect
      .poll(() => span()?.querySelector("canvas.source-span__waveform"))
      .toBeTruthy();

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

test("Paste puts the first note at the note the playhead sounds, snapped (#1397)", async () => {
  await installHarness();
  const signal = createPlayheadSignal(0);
  const onSetNotes = vi.fn();
  await render(
    <FxModulationClockContext.Provider
      value={{
        signal,
        bpm: 120,
        signature: { numerator: 4, denominator: 4 },
        isPlaying: false,
      }}
    >
      <PianoRoll
        collapsed={false}
        model={{
          spanId: "clip",
          label: "Bassline",
          accent: "#7ca1ff",
          notes: [],
          startQ: 10,
          trimStartQ: 0,
          lengthQ: 8,
          timeline: { ...defaultMidiTimeline(8), start: 2 },
          instrument: DEFAULT_INSTRUMENT,
        }}
        onAudition={() => {}}
        onSetNotes={onSetNotes}
        onSetTimeline={() => {}}
        onToggleCollapsed={() => {}}
      />
    </FxModulationClockContext.Provider>,
  );
  setNoteClipboard({
    notes: [
      { pitch: 48, start: 0, length: 1, velocity: 100 },
      { pitch: 55, start: 0.5, length: 1, velocity: 100 },
    ],
    lengthQ: 1.5,
  });
  document.querySelector<HTMLElement>("[data-piano-roll-grid]")?.focus();
  // 1.6 quarters into the clip sounds quarter 3.6 from its Start at 2,
  // which snaps down to 3.5.
  signal.set(11.6);
  await pressMod("v");
  expect(onSetNotes).toHaveBeenLastCalledWith(
    "clip",
    [
      { pitch: 48, start: 3.5, length: 1, velocity: 100 },
      { pitch: 55, start: 4, length: 1, velocity: 100 },
    ],
    "Paste Notes",
  );
  // Outside the clip, it pastes at the Start marker.
  signal.set(0);
  await pressMod("v");
  expect(onSetNotes).toHaveBeenLastCalledWith(
    "clip",
    [
      { pitch: 48, start: 2, length: 1, velocity: 100 },
      { pitch: 55, start: 2.5, length: 1, velocity: 100 },
    ],
    "Paste Notes",
  );
});
