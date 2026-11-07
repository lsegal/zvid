import { beforeEach, describe, expect, test } from "vitest";
import { patchProjectState } from "../../app/session-project.ts";
import { getShortcutLabels } from "../../app/shortcut-labels.ts";
import { getClipDurationQ } from "../../app/timeline-math.ts";
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
  nextFrames,
} from "../../component-test/input.ts";
import { setViewport } from "../../component-test/viewport.ts";
import { createFillClip } from "../../fill-clip.ts";
import { ClipCard } from "./ClipCard";
import { SourceSpan } from "./SourceSpan";

// A layer clip's move or trim commits where the pointer was released, even
// when the release comes before React renders the last move, as on a busy
// main thread (#1605). Wired as App wires it, in the editor harness.
void [ClipCard, SourceSpan];

const MOD: Modifier = getShortcutLabels().mac ? "Meta" : "Control";

beforeEach(async () => {
  await setViewport({ width: 1600, height: 1200 });
});

// Fill clips a and c on the first layer, b on the second, and the test
// pattern on a source track starting at 0.
function project(): ProjectState {
  const base = withTestPatternTrack(sessionWithLayers(3));
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
    .poll(() => document.querySelector(".source-span"))
    .not.toBeNull();
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

const body = (id: string) =>
  element(`.clip-card[data-clip-id="${id}"] .clip-card__body`);
const handle = (id: string, edge: "start" | "end") =>
  element(`.clip-card[data-clip-id="${id}"] .clip-card__handle--${edge}`);
const quarterPx = () =>
  element('.clip-card[data-clip-id="a"]').getBoundingClientRect().width / 4;

function clipOf(state: EditorState, id: string) {
  const clip = state.project.clips.find((item) => item.id === id);
  if (!clip) {
    throw new Error(`No clip ${id}`);
  }
  return clip;
}

const durationQ = (state: EditorState, id: string) =>
  getClipDurationQ(clipOf(state, id), state.project.bpm);

// Each clip's start, rounded to a quarter, sorted.
function starts(state: EditorState) {
  return state.project.clips
    .map((clip) => Math.round(clip.startQ))
    .sort((x, y) => x - y);
}

function selectedIds() {
  return [
    ...document.querySelectorAll<HTMLElement>(".clip-card--selected"),
  ].map((item) => item.dataset.clipId);
}

// Presses `target`, drags it by `renderedDx` and lets React render that. The
// function it returns sends the last move, `lastDx` from the press, and the
// release in one task, so React can't render the move between them.
async function pressAndDrag(
  target: HTMLElement,
  renderedDx: number,
  modifiers: readonly Modifier[] = [],
) {
  const from = center(target);
  let pointerId = 0;
  window.addEventListener(
    "pointerdown",
    (event) => {
      pointerId = event.pointerId;
    },
    { capture: true, once: true },
  );
  await move(from.x, from.y, { modifiers });
  await down({ modifiers });
  if (renderedDx) {
    await move(from.x + renderedDx, from.y, { steps: 6, modifiers });
  }
  await nextFrames();
  return (lastDx: number) => {
    const pointer = (type: string) =>
      window.dispatchEvent(
        new PointerEvent(type, {
          pointerId,
          clientX: from.x + lastDx,
          clientY: from.y,
        }),
      );
    pointer("pointermove");
    pointer("pointerup");
  };
}

async function selectClips(...ids: string[]) {
  for (const [index, id] of ids.entries()) {
    const { x, y } = center(body(id));
    await click(x, y, index ? { modifiers: ["Shift"] } : {});
  }
  await expect.poll(() => selectedIds().sort()).toEqual([...ids].sort());
}

describe("a release before the last move renders", {
  timeout: EDITOR_TEST_TIMEOUT,
}, () => {
  test("moves a clip to the pointer", async () => {
    const state = await renderProject();
    const q = quarterPx();
    const release = await pressAndDrag(body("a"), 3 * q);
    release(4 * q);
    await expect.poll(() => clipOf(state(), "a").startQ).toBe(4);
  });

  test("keeps a drag with no rendered move at all", async () => {
    const state = await renderProject();
    const q = quarterPx();
    const release = await pressAndDrag(body("a"), 0);
    release(4 * q);
    await expect.poll(() => clipOf(state(), "a").startQ).toBe(4);
    await expect.poll(selectedIds).toEqual(["a"]);
  });

  test("trims a clip's start to the pointer", async () => {
    const state = await renderProject();
    const q = quarterPx();
    const release = await pressAndDrag(handle("c", "start"), q);
    release(2 * q);
    await expect.poll(() => clipOf(state(), "c").startQ).toBe(14);
    expect(durationQ(state(), "c")).toBe(2);
  });

  test("trims a clip's end to the pointer", async () => {
    const state = await renderProject();
    const q = quarterPx();
    const release = await pressAndDrag(handle("a", "end"), 3 * q);
    release(4 * q);
    await expect.poll(() => durationQ(state(), "a")).toBe(8);
    expect(clipOf(state(), "a").startQ).toBe(0);
  });

  test("duplicates a clip at the pointer", async () => {
    const state = await renderProject();
    const q = quarterPx();
    const release = await pressAndDrag(body("a"), 3 * q, [MOD]);
    release(4 * q);
    await expect.poll(() => starts(state())).toEqual([0, 4, 8, 12]);
  });

  test("duplicates a selected group at the pointer", async () => {
    const state = await renderProject();
    await selectClips("a", "b");
    const q = quarterPx();
    const release = await pressAndDrag(body("a"), 3 * q, [MOD]);
    release(4 * q);
    await expect.poll(() => starts(state())).toEqual([0, 4, 8, 12, 12]);
    expect(selectedIds()).toHaveLength(2);
    expect(selectedIds()).not.toContain("a");
  });

  test("moves a selected group, source clip included, to the pointer", async () => {
    const state = await renderProject();
    await selectClips("a", "b");
    const span = element(".source-span__body");
    span.scrollIntoView({ block: "nearest", inline: "nearest" });
    const spanCenter = center(span);
    await click(spanCenter.x, spanCenter.y, { modifiers: ["Shift"] });
    const q = quarterPx();
    const release = await pressAndDrag(body("a"), 3 * q);
    release(4 * q);
    await expect.poll(() => clipOf(state(), "a").startQ).toBe(4);
    expect(clipOf(state(), "b").startQ).toBe(12);
    expect(state().project.sourceSpans[0].startQ).toBe(4);
    await expect.poll(() => selectedIds().sort()).toEqual(["a", "b"]);
  });

  test("a group dragged back to where it was pressed is still a click", async () => {
    const state = await renderProject();
    await selectClips("a", "b");
    const q = quarterPx();
    const release = await pressAndDrag(body("a"), 3 * q);
    release(0);
    await expect.poll(selectedIds).toEqual(["b"]);
    expect(starts(state())).toEqual([0, 8, 12]);
    expect(state().canUndo).toBe(false);
  });

  test("a duplicate dragged back to where it was pressed makes no copy", async () => {
    const state = await renderProject();
    const q = quarterPx();
    const release = await pressAndDrag(body("a"), 3 * q, [MOD]);
    release(0);
    await expect.poll(selectedIds).toEqual(["a"]);
    expect(starts(state())).toEqual([0, 8, 12]);
    expect(state().canUndo).toBe(false);
  });
});
