import { beforeEach, expect, test } from "vitest";
import { createWindowClip } from "../../app/clip-ops.ts";
import { patchProjectState } from "../../app/session-project.ts";
import type { ArrangementClip, ProjectState } from "../../app/types.ts";
import {
  EDITOR_TEST_TIMEOUT,
  type EditorState,
  renderEditor,
  sessionWithLayers,
  withTestPatternTrack,
} from "../../component-test/editor.tsx";
import { center, click, down, move, undo, up } from "../../component-test/input.ts";
import { setViewport } from "../../component-test/viewport.ts";
import { createFillClip } from "../../fill-clip.ts";
import { ClipCard } from "./ClipCard";
import { SourceSpan } from "./SourceSpan";

// Dragging one source clip of a multi-selection (#1483) moves every
// selected source clip, and every selected layer clip, by its offset in one
// undo step. Clips that aren't selected never move with it, even layer
// clips showing the moved source clips, and a layer clip drag moves only
// the source clips selected with it. Wired as App wires them, in the editor
// harness.
void [ClipCard, SourceSpan];

beforeEach(async () => {
  await setViewport({ width: 1600, height: 1200 });
});

// Fill clips a and b on the first two layers, the eight-quarter test
// pattern three times in one source track (s1 at 0, s2 at 12, s3 at 28),
// and on the third layer a clip w showing s2.
function project(): ProjectState {
  const base = withTestPatternTrack(sessionWithLayers(3));
  const [first] = base.sourceSpans;
  const sourceSpans = [
    first,
    { ...first, id: "s2", startQ: 12 },
    { ...first, id: "s3", startQ: 28 },
  ];
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
  const window = createWindowClip(
    { laneId: "3", startQ: 12, durationQ: 8 },
    base.sourceTracks[0],
    sourceSpans[1],
    sourceSpans,
    base.bpm,
    "w",
  );
  return patchProjectState(base, {
    clips: [fill("a", "1", 0), fill("b", "2", 8), window],
    sourceSpans,
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
  await expect
    .poll(() => document.querySelectorAll(".source-span").length)
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

const clipBody = (id: string) =>
  element(`.clip-card[data-clip-id="${id}"] .clip-card__body`);
const sourceSpan = (index: number) =>
  document.querySelectorAll<HTMLElement>(".source-span")[index];
const quarterPx = () =>
  element('.clip-card[data-clip-id="a"]').getBoundingClientRect().width / 4;

function selectedIds() {
  return [
    ...document.querySelectorAll<HTMLElement>(
      ".clip-card--selected, .source-span--selected",
    ),
  ]
    .map((item) => item.dataset.clipId ?? item.dataset.sourceSpanId)
    .sort();
}

// Clicks each target in turn, Shift-clicking all but the first.
async function select(...targets: HTMLElement[]) {
  for (const [index, target] of targets.entries()) {
    const { x, y } = center(target);
    await click(x, y, index ? { modifiers: ["Shift"] } : {});
  }
}

// Drags `target` by `dx` pixels, staying on its row.
async function dragBy(target: HTMLElement, dx: number) {
  const start = center(target);
  await move(start.x, start.y);
  await down();
  await move(start.x + dx, start.y, { steps: 6 });
  await up();
}

// Each source clip's start, in order.
const spanStarts = (state: EditorState) =>
  state.project.sourceSpans.map((span) => Math.round(span.startQ));

// Each layer clip as [id, layer, start] by id, with the time w's window
// shows on the source track, relative to its own.
function layerClips(state: EditorState) {
  return state.project.clips
    .map((clip: ArrangementClip) => [
      clip.id,
      clip.laneId,
      Math.round(clip.startQ),
      clip.kind
        ? null
        : clip.sourceOffsetSeconds - (clip.sourceSpanOffsetSeconds ?? 0),
    ])
    .sort((x, y) => String(x[0]).localeCompare(String(y[0])));
}

test("dragging one of several selected source clips moves them all, and no layer clip", {
  timeout: EDITOR_TEST_TIMEOUT,
}, async () => {
  const state = await renderProject();
  const before = layerClips(state());
  const spanIds = state().project.sourceSpans.map((span) => span.id);
  await select(sourceSpan(0), sourceSpan(1), sourceSpan(2));
  await expect.poll(selectedIds).toEqual([...spanIds].sort());

  await dragBy(sourceSpan(0), 4 * quarterPx());
  await expect.poll(() => spanStarts(state())).toEqual([4, 16, 32]);
  // w showed s2 and isn't selected: it stays, its window where it was.
  expect(layerClips(state())).toEqual(before);
  // They stay selected.
  expect(selectedIds()).toEqual([...spanIds].sort());

  await undo();
  await expect.poll(() => spanStarts(state())).toEqual([0, 12, 28]);
  expect(state().status).toBe("Undid: Move 3 clips.");
});

test("source and layer clips selected together move by the same offset", {
  timeout: EDITOR_TEST_TIMEOUT,
}, async () => {
  const state = await renderProject();
  await select(clipBody("a"), sourceSpan(1));
  await expect
    .poll(selectedIds)
    .toEqual(["a", state().project.sourceSpans[1].id].sort());

  // From the source clip...
  await dragBy(sourceSpan(1), 4 * quarterPx());
  await expect.poll(() => spanStarts(state())).toEqual([0, 16, 28]);
  expect(layerClips(state()).map((clip) => clip.slice(0, 3))).toEqual([
    ["a", "1", 4],
    ["b", "2", 8],
    ["w", "3", 12],
  ]);

  // ...and from the layer clip.
  await dragBy(clipBody("a"), 4 * quarterPx());
  await expect.poll(() => spanStarts(state())).toEqual([0, 20, 28]);
  expect(layerClips(state()).map((clip) => clip.slice(0, 3))).toEqual([
    ["a", "1", 8],
    ["b", "2", 8],
    ["w", "3", 12],
  ]);

  await undo();
  await expect.poll(() => spanStarts(state())).toEqual([0, 16, 28]);
  expect(state().status).toBe("Undid: Move 2 clips.");
  expect(layerClips(state())[0].slice(0, 3)).toEqual(["a", "1", 4]);
});

test("dragging selected layer clips moves no source clip", {
  timeout: EDITOR_TEST_TIMEOUT,
}, async () => {
  const state = await renderProject();
  await select(clipBody("a"), clipBody("w"));
  await expect.poll(selectedIds).toEqual(["a", "w"]);

  await dragBy(clipBody("a"), 4 * quarterPx());
  await expect
    .poll(() => layerClips(state()).map((clip) => clip.slice(0, 3)))
    .toEqual([
      ["a", "1", 4],
      ["b", "2", 8],
      ["w", "3", 16],
    ]);
  expect(spanStarts(state())).toEqual([0, 12, 28]);
});
