import { beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { getShortcutLabels } from "../../app/shortcut-labels.ts";
import "./LaneRow";
import {
  EDITOR_TEST_TIMEOUT,
  type EditorState,
  renderEditor,
  sessionWithLayers,
  withTestPatternTrack,
} from "../../component-test/editor.tsx";
import { click, down, move, up } from "../../component-test/input.ts";

// Cut, Copy and Delete with a timeline selection act on exactly the selected
// span on its layer, and Paste reproduces what was cut. LaneRow draws the
// selection and clips; the editor harness wires the edits, menus and keys
// as App does.

const MOD = getShortcutLabels().mac ? "Meta" : "Control";

function lane(id: string) {
  const element = document.querySelector<HTMLElement>(
    `[data-timeline-lane-id="${id}"]`,
  );
  if (!element) {
    throw new Error(`Layer ${id} is not rendered`);
  }
  return element;
}

// Drags out a selection on layer `laneId` between two x offsets from the
// song start and returns its box.
async function dragSelection(laneId: string, fromX: number, toX: number) {
  const target = lane(laneId);
  // Centered vertically, so the timeline's sticky header row doesn't cover
  // the lane when the FX panel leaves the timeline short.
  const scroller = target.closest(".timeline-scroll");
  const scrollLeft = scroller?.scrollLeft ?? 0;
  target.scrollIntoView({ block: "center" });
  if (scroller) {
    scroller.scrollLeft = scrollLeft;
  }
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
  const bounds = target.getBoundingClientRect();
  const y = bounds.y + 20;
  await move(bounds.x + fromX, y);
  await down();
  await move(bounds.x + toX, y, { steps: 4 });
  await up();
  await expect
    .poll(() => target.querySelector(".timeline-selection"))
    .not.toBeNull();
  return (
    target.querySelector(".timeline-selection") as HTMLElement
  ).getBoundingClientRect();
}

// The [left, right] edges of each clip on layer `laneId`, in page pixels.
function clipEdges(laneId: string) {
  return [...lane(laneId).querySelectorAll(".clip-card")]
    .map((card) => card.getBoundingClientRect())
    .map((rect) => [rect.left, rect.right])
    .toSorted((a, b) => a[0] - b[0]);
}

// Waits for the clips on layer `laneId` to have `expected` edges, within a
// pixel.
async function expectEdges(laneId: string, expected: number[][]) {
  await expect
    .poll(() => {
      const actual = clipEdges(laneId);
      return (
        actual.length === expected.length &&
        actual.every(
          ([left, right], index) =>
            Math.abs(left - expected[index][0]) < 1 &&
            Math.abs(right - expected[index][1]) < 1,
        )
      );
    })
    .toBe(true);
}

let editor: EditorState;

describe("LaneRow range edits in the editor", {
  timeout: EDITOR_TEST_TIMEOUT,
}, () => {
  // Layers "1" to "3", as Layer 1 with two layers inserted below it, and the
  // test pattern in a new source track.
  beforeEach(async () => {
    await renderEditor({
      project: withTestPatternTrack(sessionWithLayers(3)),
      onState: (state) => {
        editor = state;
      },
    });
    await expect
      .poll(() => document.querySelectorAll(".source-span").length)
      .toBe(1);
    const scroller = document.querySelector(".timeline-scroll");
    if (scroller) {
      scroller.scrollLeft = 0;
    }

    // A clip on Layer 1 and one on Layer 3, over the same span. Selections
    // start on empty lane space, then may extend over clips.
    for (const id of ["1", "3"]) {
      await dragSelection(id, 130, 330);
      await userEvent.keyboard("1");
      await expect
        .poll(() => lane(id).querySelectorAll(".clip-card").length)
        .toBe(1);
    }
    // Opening the editor and committing two clips takes a while.
  }, 60_000);

  test("Delete removes only the selected span on its layer", async () => {
    const [clip] = clipEdges("1");
    const otherLayer = clipEdges("3");
    // Over the clip's start, so Delete trims it to the part after the span.
    const selection = await dragSelection("1", 30, 230);

    await userEvent.keyboard("{Delete}");
    await expectEdges("1", [[selection.x + selection.width, clip[1]]]);
    await expectEdges("3", otherLayer);
    // The selection stays, showing what was removed.
    expect(lane("1").querySelector(".timeline-selection")).not.toBeNull();

    // One undo step restores the clip.
    await userEvent.keyboard(`{${MOD}>}z{/${MOD}}`);
    await expectEdges("1", [clip]);
  });

  test("Cut then Paste reproduces the cut span on another layer", async () => {
    const [clip] = clipEdges("1");
    const otherLayer = clipEdges("3");
    // Dragged back over the clip's end, so the cut takes its end and some
    // empty space.
    const selection = await dragSelection("1", 530, 230);

    await userEvent.keyboard(`{${MOD}>}x{/${MOD}}`);
    await expectEdges("1", [[clip[0], selection.x]]);
    await expectEdges("3", otherLayer);

    // Paste at the playhead on the selected layer: the cut piece, at the same
    // length.
    await userEvent.keyboard("{Escape}");
    const label = [
      ...document.querySelectorAll<HTMLElement>(".track-label--lane"),
    ].find((element) => element.textContent?.includes("Layer 2"));
    const index = label?.querySelector(".track-label__index");
    if (!index) {
      throw new Error("Layer 2 has no index");
    }
    await userEvent.click(page.elementLocator(index));
    await userEvent.keyboard(`{${MOD}>}v{/${MOD}}`);
    await expect
      .poll(() => lane("2").querySelectorAll(".clip-card").length)
      .toBe(1);
    const [pasted] = clipEdges("2");
    expect(pasted[1] - pasted[0]).toBeCloseTo(clip[1] - selection.x, 0);
    await expectEdges("1", [[clip[0], selection.x]]);
    await expectEdges("3", otherLayer);
  });

  test("Copy and Delete leave an empty selection alone", async () => {
    const clips = clipEdges("1");
    await dragSelection("1", 430, 530);

    await userEvent.keyboard(`{${MOD}>}c{/${MOD}}`);
    await expect
      .poll(() => editor.status)
      .toBe("Nothing in the selection to copy.");
    await userEvent.keyboard("{Delete}");
    await expectEdges("1", clips);
  });

  test("the selection menu's Cut, Copy and Delete act on the span", async () => {
    const [clip] = clipEdges("1");
    const selection = await dragSelection("1", 30, 230);
    const bounds = lane("1").getBoundingClientRect();
    await click(bounds.x + 80, bounds.y + 20, { button: "right" });
    const menu = page.getByRole("menu", { name: "Selection actions" });
    await expect.element(menu).toBeVisible();
    const items = menu
      .getByRole("menuitem")
      .elements()
      .map((item) => item.textContent ?? "");
    expect(items).toHaveLength(8);
    expect(items[0]).toMatch(/^Cut/);
    expect(items[1]).toMatch(/^Copy/);
    expect(items[2]).toMatch(/^Delete/);
    expect(items.slice(3)).toEqual([
      "Insert Track",
      "Insert Fill Clip",
      "Insert Text Clip",
      "Insert FX Clip",
      "Clear selectionEsc",
    ]);
    await menu.getByRole("menuitem", { name: /^Delete/ }).click();
    await expectEdges("1", [[selection.x + selection.width, clip[1]]]);
  });
});
