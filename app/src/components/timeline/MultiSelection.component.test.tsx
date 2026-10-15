import { beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { patchProjectState } from "../../app/session-project.ts";
import { getShortcutLabels } from "../../app/shortcut-labels.ts";
import type { ProjectState } from "../../app/types.ts";
import {
  EDITOR_TEST_TIMEOUT,
  type EditorState,
  renderEditor,
  sessionWithLayers,
  withTestPatternTrack,
} from "../../component-test/editor.tsx";
import {
  center,
  click,
  down,
  type Modifier,
  move,
  pressMod,
  up,
} from "../../component-test/input.ts";
import { setViewport } from "../../component-test/viewport.ts";
import { createFillClip } from "../../fill-clip.ts";
import { MARQUEE_CURSOR_CLASS } from "../../hooks/useMarqueeSelection.ts";
import { ClipCard } from "./ClipCard";
import { LaneRow } from "./LaneRow";
import { SourceSpan } from "./SourceSpan";

// Selecting several clips at once (multi-selection.ts): Shift-clicking
// layer and source clips (Ctrl/Cmd-click keeps its own meanings), a marquee drawn in the source tracks, and a layer
// drag that turns into a marquee off its layer, with Delete, Copy and Paste
// acting on the whole selection. Wired as App wires them, in the editor
// harness.
void [ClipCard, LaneRow, SourceSpan];

beforeEach(async () => {
  await setViewport({ width: 1600, height: 1200 });
});

// Three layers, a fill clip on each of the first two, and a source track
// holding the four-second test pattern twice: at quarter 0 and quarter 12.
function project(): ProjectState {
  const base = withTestPatternTrack(sessionWithLayers(3));
  const [first] = base.sourceSpans;
  const fill = (id: string, laneId: string, startQ: number) =>
    createFillClip({
      id,
      laneId,
      startQ,
      durationQ: 4,
      bpm: base.bpm,
      tint: "#2a2d38",
      accent: "#8d93a8",
    });
  return patchProjectState(base, {
    clips: [fill("a", "1", 0), fill("b", "2", 8)],
    sourceSpans: [first, { ...first, id: "second-span", startQ: 12 }],
  });
}

async function renderProject() {
  const state: { current?: EditorState } = {};
  await renderEditor({
    project: project(),
    onState: (next) => {
      state.current = next;
    },
  });
  await expect
    .poll(() => document.querySelectorAll(".clip-card").length)
    .toBe(2);
  await expect
    .poll(() => document.querySelectorAll(".source-span").length)
    .toBe(2);
  return () => {
    if (!state.current) {
      throw new Error("The editor never rendered");
    }
    return state.current;
  };
}

function element(selector: string) {
  const match = document.querySelector<HTMLElement>(selector);
  if (!match) {
    throw new Error(`Nothing matches ${selector}`);
  }
  return match;
}

const clipCard = (id: string) => element(`.clip-card[data-clip-id="${id}"]`);
const sourceSpan = (index: number) =>
  document.querySelectorAll<HTMLElement>(".source-span")[index];
const lane = (id: string) => element(`[data-timeline-lane-id="${id}"]`);

function selectedIds() {
  return [
    ...document.querySelectorAll<HTMLElement>(
      ".clip-card--selected, .source-span--selected",
    ),
  ].map((item) => item.dataset.clipId ?? item.dataset.sourceSpanId);
}

async function clickClip(target: HTMLElement, shift = false) {
  const { x, y } = center(target.querySelector(".clip-card__body") ?? target);
  await click(x, y, shift ? { modifiers: ["Shift"] } : {});
}

test("Shift-click adds layer and source clips to the selection and takes them out", {
  timeout: EDITOR_TEST_TIMEOUT,
}, async () => {
  await renderProject();

  await clickClip(clipCard("a"));
  await clickClip(clipCard("b"), true);
  await expect.poll(selectedIds).toEqual(["a", "b"]);

  const span = sourceSpan(0);
  await click(center(span).x, center(span).y, { modifiers: ["Shift"] });
  await expect
    .poll(() => selectedIds().sort())
    .toEqual(["a", "b", span.dataset.sourceSpanId].sort());

  // Shift-clicking a selected clip takes it out.
  await clickClip(clipCard("a"), true);
  await expect
    .poll(() => selectedIds().sort())
    .toEqual(["b", span.dataset.sourceSpanId].sort());

  // A plain click selects just the clip clicked.
  await clickClip(clipCard("a"));
  await expect.poll(selectedIds).toEqual(["a"]);
});

test("Ctrl/Cmd-click jumps to a layer clip or adds a source clip, selecting just that clip", {
  timeout: EDITOR_TEST_TIMEOUT,
}, async () => {
  const state = await renderProject();
  const mod: Modifier = getShortcutLabels().mac ? "Meta" : "Control";
  const modName = getShortcutLabels().mac ? "Cmd" : "Ctrl";

  // The tooltips name both gestures.
  expect(element(".clip-card__body").title).toBe(
    `${modName}+click to jump to start, Shift+click to add to or remove from the selection`,
  );
  expect(sourceSpan(0).title).toBe(
    `${modName}+click to add this clip to the arrangement, Shift+click to add it to or remove it from the selection`,
  );

  // On a layer clip in the selection: selects just it and jumps to its
  // start, rather than toggling it.
  await clickClip(clipCard("a"));
  await clickClip(clipCard("b"), true);
  await expect.poll(selectedIds).toEqual(["a", "b"]);
  const body = clipCard("b").querySelector(".clip-card__body") ?? clipCard("b");
  await click(center(body).x, center(body).y, { modifiers: [mod] });
  await expect.poll(selectedIds).toEqual(["b"]);
  await expect.poll(() => Math.round(state().playheadQ())).toBe(8);
  expect(state().project.clips).toHaveLength(2);

  // On a source clip: adds it to the arrangement and selects the new clip
  // alone, without toggling the source clip.
  await clickClip(clipCard("a"), true);
  await expect.poll(() => selectedIds().sort()).toEqual(["a", "b"]);
  const span = sourceSpan(0);
  await click(center(span).x, center(span).y, { modifiers: [mod] });
  await expect.poll(() => state().project.clips.length).toBe(3);
  const added = state().project.clips.find(
    (clip) => clip.id !== "a" && clip.id !== "b",
  );
  await expect.poll(selectedIds).toEqual([added?.id]);
});

test("Delete removes every selected clip in one undo step", {
  timeout: EDITOR_TEST_TIMEOUT,
}, async () => {
  const state = await renderProject();

  await clickClip(clipCard("a"));
  await clickClip(clipCard("b"), true);
  const span = sourceSpan(1);
  await click(center(span).x, center(span).y, { modifiers: ["Shift"] });
  await expect.poll(() => selectedIds().length).toBe(3);

  await userEvent.keyboard("{Delete}");
  await expect.poll(() => state().project.clips).toEqual([]);
  expect(state().project.sourceSpans.map((item) => item.startQ)).toEqual([0]);
  expect(state().status).toBe("Deleted 3 clips.");

  await pressMod("z");
  await expect.poll(() => state().project.clips.length).toBe(2);
  expect(state().project.sourceSpans).toHaveLength(2);
});

test("Copy and Paste keep the clips' offsets and layers", {
  timeout: EDITOR_TEST_TIMEOUT,
}, async () => {
  const state = await renderProject();

  await clickClip(clipCard("a"));
  await clickClip(clipCard("b"), true);
  await pressMod("c");
  expect(state().status).toBe("Copied 2 clips.");

  // Park the playhead at quarter 16 from empty space on the first layer,
  // which the topmost copied clip pastes onto.
  const laneBox = lane("1").getBoundingClientRect();
  const quarterPx = clipCard("a").getBoundingClientRect().width / 4;
  await click(laneBox.left + 16 * quarterPx + 1, laneBox.top + 20);
  await expect.poll(() => Math.round(state().playheadQ())).toBe(16);

  await pressMod("v");
  await expect.poll(() => state().project.clips.length).toBe(4);
  const pasted = state()
    .project.clips.filter((clip) => clip.id !== "a" && clip.id !== "b")
    .map((clip) => [clip.laneId, Math.round(clip.startQ)])
    .sort();
  expect(pasted).toEqual([
    ["1", 16],
    ["2", 24],
  ]);
  // What was pasted is selected.
  await expect.poll(() => selectedIds().length).toBe(2);
  expect(selectedIds()).not.toContain("a");
});

test("dragging in a source track draws an accent marquee that selects what it touches", {
  timeout: EDITOR_TEST_TIMEOUT,
}, async () => {
  await renderProject();
  const row = element(".track-row__content--source");
  const rowBox = row.getBoundingClientRect();
  const [firstSpan, secondSpan] = [sourceSpan(0), sourceSpan(1)];
  const gapX =
    (firstSpan.getBoundingClientRect().right +
      secondSpan.getBoundingClientRect().left) /
    2;

  // From the empty space between the source clips, up and left over the
  // first source clip and layer clip b.
  await move(gapX, rowBox.top + rowBox.height / 2);
  await down();
  const target = clipCard("b").getBoundingClientRect();
  await move(firstSpan.getBoundingClientRect().right - 4, target.top + 4, {
    steps: 4,
  });
  await expect
    .poll(() => document.querySelector(".marquee-box"))
    .not.toBeNull();
  expect(document.body.classList.contains(MARQUEE_CURSOR_CLASS)).toBe(true);
  expect(getComputedStyle(row).cursor).toBe("crosshair");
  await up();

  await expect.poll(() => document.querySelector(".marquee-box")).toBeNull();
  expect(document.body.classList.contains(MARQUEE_CURSOR_CLASS)).toBe(false);
  // The source track stays unselected: the release isn't a click on it.
  await expect
    .poll(() => selectedIds().sort())
    .toEqual(["b", firstSpan.dataset.sourceSpanId].sort());
});

test("a layer drag turns into a marquee off its layer and back into a range on it", {
  timeout: EDITOR_TEST_TIMEOUT,
}, async () => {
  const state = await renderProject();
  const quarterPx = clipCard("a").getBoundingClientRect().width / 4;
  const laneBox = lane("3").getBoundingClientRect();
  const y = laneBox.top + laneBox.height / 2;
  const startX = laneBox.left + 2 * quarterPx;

  await move(startX, y);
  await down();
  await move(startX + 12 * quarterPx, y, { steps: 4 });
  await expect
    .poll(() => lane("3").querySelectorAll(".timeline-selection").length)
    .toBe(1);
  const rangeWidth = element(".timeline-selection").getBoundingClientRect()
    .width;

  // Up over layer clip b: the range goes and a marquee selects b.
  await move(
    startX + 12 * quarterPx,
    clipCard("b").getBoundingClientRect().top + 4,
    {
      steps: 4,
    },
  );
  await expect
    .poll(() => document.querySelector(".marquee-box"))
    .not.toBeNull();
  expect(document.querySelectorAll(".timeline-selection")).toHaveLength(0);
  await expect.poll(selectedIds).toEqual(["b"]);

  // Back on the layer: the range returns as it was, the marquee goes.
  await move(startX + 12 * quarterPx, y, { steps: 4 });
  await expect.poll(() => document.querySelector(".marquee-box")).toBeNull();
  await expect
    .poll(() => lane("3").querySelectorAll(".timeline-selection").length)
    .toBe(1);
  expect(
    element(".timeline-selection").getBoundingClientRect().width,
  ).toBeCloseTo(rangeWidth, 0);
  expect(selectedIds()).toEqual([]);

  // Released off the layer, the drag keeps what its marquee selected.
  await move(
    startX + 12 * quarterPx,
    clipCard("b").getBoundingClientRect().top + 4,
    {
      steps: 4,
    },
  );
  await up();
  await expect.poll(() => document.querySelector(".marquee-box")).toBeNull();
  expect(selectedIds()).toEqual(["b"]);
  expect(document.querySelectorAll(".timeline-selection")).toHaveLength(0);
  expect(state().project.clips).toHaveLength(2);
});
