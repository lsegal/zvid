import { beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { click, down, move, up } from "../../component-test/cdp-mouse.ts";
import {
  renderEditor,
  sessionWithLayers,
} from "../../component-test/editor-harness.tsx";
import { setViewport } from "../../component-test/viewport.ts";
import "./SelectionOverlay";

// A drawn range selection moves when its body is dragged, onto another
// layer too, and resizes from either edge handle. A click inside it keeps
// it; a click anywhere else in the timeline clears it (#918). SelectionOverlay
// draws it; the editor harness wires its drags, menus and keys as App does.

function lane(id: string) {
  const element = document.querySelector<HTMLElement>(
    `[data-timeline-lane-id="${id}"]`,
  );
  if (!element) {
    throw new Error(`Layer ${id} is not rendered`);
  }
  return element;
}

function selectionIn(laneId: string) {
  return lane(laneId).querySelector<HTMLElement>(".timeline-selection");
}

function selectionCount() {
  return document.querySelectorAll(".timeline-selection").length;
}

function boxOf(element: Element | null) {
  if (!element) {
    throw new Error("Element is not rendered");
  }
  return element.getBoundingClientRect();
}

// Drags from the center of `from` by `dx` to `toY`, past the click
// threshold.
async function dragBy(from: Element | null, dx: number, toY?: number) {
  const box = boxOf(from);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await move(x, y);
  await down();
  await move(x + dx / 2, (y + (toY ?? y)) / 2, { steps: 4 });
  await move(x + dx, toY ?? y, { steps: 4 });
  await up();
}

// Draws a selection on the lane from `fromX` to `toX` past its left edge.
async function drawSelection(laneId: string, fromX: number, toX: number) {
  const bounds = boxOf(lane(laneId));
  const y = bounds.y + 20;
  await move(bounds.x + fromX, y);
  await down();
  await move(bounds.x + toX, y, { steps: 4 });
  await up();
  await expect.poll(() => selectionIn(laneId)).not.toBeNull();
  return selectionIn(laneId) as HTMLElement;
}

describe("SelectionOverlay in the editor", () => {
  // The docked Audio row leaves less room for layers; all three layers fit
  // at this size.
  beforeEach(async () => {
    await setViewport({ width: 1600, height: 1200 });
    // Layers "1" to "3", as Layer 1 with two layers inserted below it.
    await renderEditor({ project: sessionWithLayers(3) });
    await expect.poll(() => document.querySelector('[data-timeline-lane-id="3"]')).not.toBeNull();
    const scroller = document.querySelector(".timeline-scroll");
    if (scroller) {
      scroller.scrollLeft = 0;
    }
  });

  test("dragging a selection moves it in time and onto another layer", async () => {
    const selection = await drawSelection("2", 40, 280);
    const before = boxOf(selection);
    expect(selection.textContent).toContain("Press 1-9 to commit");

    // Along its own layer.
    await dragBy(selection, 120);
    await expect
      .poll(() => boxOf(selectionIn("2")).x - before.x)
      .toBeGreaterThan(80);
    const moved = boxOf(selectionIn("2"));
    expect(moved.width).toBeCloseTo(before.width, 0);

    // Onto Layer 3.
    const target = boxOf(lane("3"));
    await dragBy(selectionIn("2"), 0, target.y + target.height / 2);
    await expect.poll(() => selectionIn("3")).not.toBeNull();
    expect(selectionIn("2")).toBeNull();
    const onLayer3 = selectionIn("3") as HTMLElement;
    const landed = boxOf(onLayer3);
    expect(landed.x).toBeCloseTo(moved.x, 0);
    expect(landed.width).toBeCloseTo(before.width, 0);
    expect(onLayer3.textContent).toContain("Press 1-9 to commit");

    // Its menu still opens on a right-click inside it.
    await click(landed.x + landed.width / 2, landed.y + landed.height / 2, {
      button: "right",
    });
    await expect
      .element(page.getByRole("menu", { name: "Selection actions" }))
      .toBeVisible();
    expect(selectionIn("3")).not.toBeNull();
  });

  test("dragging an edge handle resizes the selection from that edge", async () => {
    const selection = await drawSelection("2", 200, 440);
    const before = boxOf(selection);
    const right = before.x + before.width;
    const handle = (edge: "start" | "end") =>
      selectionIn("2")?.querySelector(
        `.timeline-selection__handle--${edge}`,
      ) ?? null;

    // The end handle moves the end and keeps the start.
    await dragBy(handle("end"), 120);
    await expect
      .poll(() => boxOf(selectionIn("2")).width - before.width)
      .toBeGreaterThan(80);
    const widened = boxOf(selectionIn("2"));
    expect(widened.x).toBeCloseTo(before.x, 0);

    // The start handle moves the start and keeps the end.
    await dragBy(handle("start"), -120);
    await expect
      .poll(() => before.x - boxOf(selectionIn("2")).x)
      .toBeGreaterThan(80);
    const resized = boxOf(selectionIn("2"));
    expect(resized.x + resized.width).toBeCloseTo(widened.x + widened.width, 0);
    expect(widened.x + widened.width).toBeGreaterThan(right);

    // Dragging the start past the end leaves the shortest selection.
    await dragBy(handle("start"), 800);
    expect(selectionCount()).toBe(1);
    const shortest = boxOf(selectionIn("2"));
    expect(shortest.width).toBeLessThan(40);
    expect(shortest.x + shortest.width).toBeCloseTo(
      resized.x + resized.width,
      0,
    );
  });

  test("a click inside the selection keeps it and a click outside clears it", async () => {
    const selection = await drawSelection("2", 40, 280);
    const before = boxOf(selection);

    // A click, or a press with jitter under the drag threshold, keeps it in
    // place.
    await click(before.x + before.width / 2, before.y + 10);
    expect(selectionCount()).toBe(1);
    const x = before.x + before.width / 2;
    await move(x, before.y + 10);
    await down();
    await move(x + 2, before.y + 10);
    await up();
    const after = boxOf(selectionIn("2"));
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.width).toBeCloseTo(before.width, 0);

    // A click on the same layer outside it clears it.
    const laneBox = boxOf(lane("2"));
    await click(laneBox.x + 500, laneBox.y + 20);
    await expect.poll(selectionCount).toBe(0);

    // So does a click on another layer.
    await drawSelection("2", 40, 280);
    const otherLane = boxOf(lane("3"));
    await click(otherLane.x + 100, otherLane.y + 20);
    await expect.poll(selectionCount).toBe(0);

    // And a click on the ruler.
    await drawSelection("2", 40, 280);
    const ruler = boxOf(document.querySelector(".ruler-row__content"));
    await click(ruler.x + 500, ruler.y + ruler.height / 2);
    await expect.poll(selectionCount).toBe(0);

    // Escape still clears it.
    await drawSelection("2", 40, 280);
    await userEvent.keyboard("{Escape}");
    await expect.poll(selectionCount).toBe(0);
  });
});
