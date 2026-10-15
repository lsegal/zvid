import { beforeEach, expect, test } from "vitest";
import { patchProjectState } from "../../app/session-project.ts";
import { getShortcutLabels } from "../../app/shortcut-labels.ts";
import type { ProjectState } from "../../app/types.ts";
import {
  EDITOR_TEST_TIMEOUT,
  type EditorState,
  renderEditor,
  sessionWithLayers,
} from "../../component-test/editor.tsx";
import {
  center,
  click,
  down,
  type Modifier,
  move,
  undo,
  up,
} from "../../component-test/input.ts";
import { setViewport } from "../../component-test/viewport.ts";
import { createFillClip } from "../../fill-clip.ts";
import { clipEffectTrackId } from "../../fx-stack";
import { ClipCard } from "./ClipCard";

// Dragging one clip of a multi-selection (#1470) moves, or Ctrl/Cmd-drag
// duplicates, every selected clip by its offset in one undo step, while a
// trim handle still trims just its clip. Wired as App wires it, in the
// editor harness.
void ClipCard;

const MOD: Modifier = getShortcutLabels().mac ? "Meta" : "Control";

beforeEach(async () => {
  await setViewport({ width: 1600, height: 1200 });
});

// Three layers with fill clips a and c on the first and b on the second,
// b with a stack of its own.
function project(): ProjectState {
  const base = sessionWithLayers(3);
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
    clips: [fill("a", "1", 0), fill("b", "2", 8), fill("c", "1", 12)],
    effects: [
      ...base.effects,
      { ...base.effects[0], id: "b-fx", trackId: clipEffectTrackId("b") },
    ],
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
    .toBe(3);
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
const lane = (id: string) => element(`[data-timeline-lane-id="${id}"]`);
const quarterPx = () => clipCard("a").getBoundingClientRect().width / 4;

function selectedIds() {
  return [
    ...document.querySelectorAll<HTMLElement>(".clip-card--selected"),
  ].map((item) => item.dataset.clipId);
}

// Each clip as [id, layer, start] by id.
function placement(state: EditorState) {
  return state.project.clips
    .map((clip) => [clip.id, clip.laneId, Math.round(clip.startQ)])
    .sort((x, y) => String(x[0]).localeCompare(String(y[0])));
}

async function selectAll() {
  for (const [id, shift] of [
    ["a", false],
    ["b", true],
    ["c", true],
  ] as const) {
    const { x, y } = center(
      element(`.clip-card[data-clip-id="${id}"] .clip-card__body`),
    );
    await click(x, y, shift ? { modifiers: ["Shift"] } : {});
  }
  await expect.poll(() => selectedIds().sort()).toEqual(["a", "b", "c"]);
}

// Drags the body of clip `id` by `dx` pixels and onto layer `toLaneId`.
async function dragClip(
  id: string,
  dx: number,
  toLaneId: string,
  modifiers: readonly Modifier[] = [],
) {
  const start = center(
    element(`.clip-card[data-clip-id="${id}"] .clip-card__body`),
  );
  const target = lane(toLaneId).getBoundingClientRect();
  await move(start.x, start.y, { modifiers });
  await down({ modifiers });
  await move(start.x + dx, target.top + target.height / 2, {
    steps: 6,
    modifiers,
  });
  await up({ modifiers });
}

test("dragging one selected clip moves them all in one undo step", {
  timeout: EDITOR_TEST_TIMEOUT,
}, async () => {
  const state = await renderProject();
  await selectAll();

  await dragClip("a", 4 * quarterPx(), "2");
  await expect
    .poll(() => placement(state()))
    .toEqual([
      ["a", "2", 4],
      ["b", "3", 12],
      ["c", "2", 16],
    ]);
  // They stay selected.
  expect(selectedIds().sort()).toEqual(["a", "b", "c"]);

  await undo();
  await expect
    .poll(() => placement(state()))
    .toEqual([
      ["a", "1", 0],
      ["b", "2", 8],
      ["c", "1", 12],
    ]);
  expect(state().status).toBe("Undid: Move 3 clips.");
});

test("a click on one selected clip selects just it", {
  timeout: EDITOR_TEST_TIMEOUT,
}, async () => {
  const state = await renderProject();
  await selectAll();

  const { x, y } = center(
    element('.clip-card[data-clip-id="b"] .clip-card__body'),
  );
  await click(x, y);
  await expect.poll(selectedIds).toEqual(["b"]);
  expect(state().canUndo).toBe(false);
});

test("Ctrl/Cmd-dragging one selected clip duplicates them all with their stacks", {
  timeout: EDITOR_TEST_TIMEOUT,
}, async () => {
  const state = await renderProject();
  await selectAll();

  await dragClip("b", 16 * quarterPx(), "2", [MOD]);
  await expect.poll(() => state().project.clips.length).toBe(6);
  const copies = state().project.clips.filter(
    (clip) => !["a", "b", "c"].includes(clip.id),
  );
  expect(
    copies.map((clip) => [clip.laneId, Math.round(clip.startQ)]).sort(),
  ).toEqual([
    ["1", 16],
    ["1", 28],
    ["2", 24],
  ]);
  // The copies are selected, and b's copy got its own stack.
  await expect
    .poll(() => selectedIds().sort())
    .toEqual(copies.map((clip) => clip.id).sort());
  const bCopy = copies.find((clip) => clip.laneId === "2");
  expect(
    state().project.effects.filter(
      (effect) => bCopy && effect.trackId === clipEffectTrackId(bCopy.id),
    ),
  ).toHaveLength(1);
  // The originals stay where they were.
  expect(
    placement(state()).filter(([id]) => ["a", "b", "c"].includes(String(id))),
  ).toEqual([
    ["a", "1", 0],
    ["b", "2", 8],
    ["c", "1", 12],
  ]);

  await undo();
  await expect.poll(() => state().project.clips.length).toBe(3);
  expect(state().status).toBe("Undid: Duplicate 3 clips.");
});

test("a trim handle trims only its own clip", {
  timeout: EDITOR_TEST_TIMEOUT,
}, async () => {
  const state = await renderProject();
  await selectAll();

  const handle = center(
    element('.clip-card[data-clip-id="a"] .clip-card__handle--end'),
  );
  await move(handle.x, handle.y);
  await down();
  await move(handle.x + 2 * quarterPx(), handle.y, { steps: 4 });
  await up();
  await expect
    .poll(() =>
      state().project.clips.map((clip) => [
        clip.id,
        Math.round(clip.startQ),
        Math.round((clip.durationSeconds * state().project.bpm) / 60),
      ]),
    )
    .toEqual([
      ["a", 0, 6],
      ["b", 8, 4],
      ["c", 12, 4],
    ]);
});
