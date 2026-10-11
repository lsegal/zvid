import { beforeEach, describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { MIN_GRID_SELECTION_PX } from "../../lane-selection-gesture.ts";
import { setViewport } from "../../component-test/viewport.ts";
import {
  projectWithMedia,
  TimelineHarness,
  testPatternVideo,
} from "./timeline-harness";
import { addLayers, center, mouse } from "./timeline-harness-input";
// The harness renders LaneRow; importing it ties this test to it.
import "./LaneRow";

// A layer's lane (LaneRow) in the timeline: pressing, dragging and
// double-clicking empty lane space, and how its clips and selection sit in
// it.

function lane(id: string) {
  return document.querySelector<HTMLElement>(
    `[data-timeline-lane-id="${id}"]`,
  ) as HTMLElement;
}

function selections() {
  return document.querySelectorAll<HTMLElement>(".timeline-selection");
}

// The playhead's position within the lane, independent of scroll.
function playheadX(id: string) {
  const marker = document.querySelector(
    ".timeline-playhead-marker",
  ) as HTMLElement;
  return (
    marker.getBoundingClientRect().left - lane(id).getBoundingClientRect().left
  );
}

// The spacing of the finest grid lines the lane draws, in pixels: the lane
// paints its strongest lines first, so the finest are the last layer.
function finestGridPx(element: HTMLElement) {
  const sizes = getComputedStyle(element).backgroundSize.split(",");
  return Number.parseFloat(sizes[sizes.length - 1]);
}

// The fewest whole cells `cellPx` wide that make at least 64px.
function minimumSelectionPx(cellPx: number) {
  return Math.ceil(64 / cellPx - 1e-6) * cellPx;
}

// Double-clicks `offsetX` into the lane and checks the selection starts on
// the grid cell under it and is the minimum width in whole cells.
async function expectCellAt(target: HTMLElement, offsetX: number) {
  const laneBox = target.getBoundingClientRect();
  await mouse.dblclick(laneBox.x + offsetX, laneBox.y + 20);
  await expect.poll(() => target.querySelectorAll(".timeline-selection")).toHaveLength(1);
  const selection = target.querySelector(".timeline-selection") as HTMLElement;
  const cellPx = finestGridPx(target);
  const selectionBox = selection.getBoundingClientRect();
  // Measured from the lane's padding edge, where the grid starts.
  const left = Number.parseFloat(selection.style.left);
  expect(selectionBox.width).toBeCloseTo(minimumSelectionPx(cellPx), 0);
  expect(selectionBox.width).toBeGreaterThanOrEqual(63.5);
  // It starts on the grid line at or before the click.
  expect(Math.abs(left / cellPx - Math.round(left / cellPx))).toBeLessThan(
    0.05,
  );
  expect(left).toBeLessThanOrEqual(offsetX + 1);
  expect(left + selectionBox.width).toBeGreaterThan(offsetX - 1);
  return cellPx;
}

describe("LaneRow", { timeout: 60_000 }, () => {
  // A desktop window tall enough to keep the layers clear of the docked
  // Audio row.
  beforeEach(async () => {
    localStorage.clear();
    await setViewport({ width: 1600, height: 1200 });
  });

  // A left-click on empty lane space seeks and clears the selection; only a
  // drag past a few pixels selects a range.
  test("clicking empty lane space seeks without selecting, and dragging selects", async () => {
    await render(<TimelineHarness />);
    await expect.poll(() => lane("1")).toBeTruthy();
    const target = lane("1");
    const bounds = target.getBoundingClientRect();
    const y = bounds.y + 20;

    // A plain click leaves no selection and moves the playhead there.
    const before = playheadX("1");
    await mouse.click(bounds.x + 200, y);
    expect(selections()).toHaveLength(0);
    await expect
      .poll(() => target.parentElement?.className)
      .toMatch(/track-row--selected/);
    await expect.poll(() => playheadX("1")).not.toBeCloseTo(before, 0);
    expect(Math.abs(playheadX("1") - 200)).toBeLessThan(40);

    // Jitter under the threshold is still a click.
    await mouse.move(bounds.x + 120, y);
    await mouse.down();
    await mouse.move(bounds.x + 122, y);
    expect(selections()).toHaveLength(0);
    await mouse.move(bounds.x + 118, y);
    await mouse.up();
    expect(selections()).toHaveLength(0);

    // A drag past the threshold selects from the anchor to the pointer.
    await mouse.move(bounds.x + 40, y);
    await mouse.down();
    await mouse.move(bounds.x + 150, y, { steps: 4 });
    await mouse.move(bounds.x + 260, y, { steps: 4 });
    await mouse.up();
    await expect.poll(() => selections()).toHaveLength(1);
    expect(selections()[0].getBoundingClientRect().width).toBeGreaterThan(150);

    // Clicking elsewhere clears it.
    await mouse.click(bounds.x + 400, y);
    await expect.poll(() => selections()).toHaveLength(0);
  });

  // Double-clicking empty lane space selects whole cells of the finest grid
  // drawn, with Snap on or off, and the cells follow the zoom (#1196). It
  // takes the fewest cells at least 64px wide, so both edge handles stay
  // reachable (#1214).
  test("double-clicking empty lane space selects grid cells at least 64px wide", async () => {
    const screen = await render(<TimelineHarness />);
    await expect.poll(() => lane("1")).toBeTruthy();
    const target = lane("1");
    expect(MIN_GRID_SELECTION_PX).toBe(64);
    const snap = screen.getByRole("button", { name: /^Snap (On|Off)$/ });

    await expect.element(snap).toHaveAccessibleName("Snap On");
    const zoomedOut = await expectCellAt(target, 213);

    // Snap off still lines the cell up with the grid.
    await snap.click();
    await expect.element(snap).toHaveAccessibleName("Snap Off");
    await expectCellAt(target, 377);

    // Zooming in makes the cell match the finer grid lines.
    const zoomIn = screen.getByRole("button", { name: "Zoom in" });
    for (
      let step = 0;
      step < 4 && !(zoomIn.element() as HTMLButtonElement).disabled;
      step += 1
    ) {
      await zoomIn.click();
    }
    const zoomedInPx = await expectCellAt(target, 301);
    expect(zoomedInPx).not.toBeCloseTo(zoomedOut, 0);
    // Some zoom draws cells narrower than the minimum, so a selection there
    // spans several of them.
    expect(Math.min(zoomedOut, zoomedInPx)).toBeLessThan(64);

    // The selection is the same as a dragged one: its edge resizes it.
    const selection = target.querySelector(".timeline-selection") as HTMLElement;
    const before = selection.getBoundingClientRect();
    const end = center(
      screen.getByRole("button", { name: "Resize selection end" }).element(),
    );
    await mouse.move(end.x, end.y);
    await mouse.down();
    await mouse.move(end.x + 120, end.y, { steps: 6 });
    await mouse.up();
    await expect
      .poll(
        () =>
          (
            target.querySelector(".timeline-selection") as HTMLElement
          ).getBoundingClientRect().width,
      )
      .toBeGreaterThan(before.width + 60);
  });

  // Layer lanes leave 11px above and below their 44px clips (#917), and the
  // track labels and the selection box stay aligned with them.
  test("layer lanes are compact, with clips, labels and selections aligned", async () => {
    const LANE_HEIGHT = 66;
    const CLIP_INSET = 11;
    const CLIP_HEIGHT = 44;
    const screen = await render(
      <TimelineHarness project={projectWithMedia([testPatternVideo()])} />,
    );
    await expect.poll(() => lane("1")).toBeTruthy();
    await addLayers(1);
    await mouse.click(
      center(document.querySelector(".source-span") as Element).x,
      center(document.querySelector(".source-span") as Element).y,
      { button: "right" },
    );
    await screen.getByRole("menuitem", { name: "Copy to layer" }).hover();
    await screen.getByRole("menuitem", { name: "Layer 1" }).click();
    const clipLane = lane("1");
    await expect.poll(() => clipLane.querySelectorAll(".clip-card")).toHaveLength(1);

    const laneBox = clipLane.getBoundingClientRect();
    const clip = clipLane.querySelector(".clip-card") as HTMLElement;
    const clipBox = clip.getBoundingClientRect();
    const labelBox = (
      clipLane.parentElement?.querySelector(".track-label") as HTMLElement
    ).getBoundingClientRect();
    // The lane's bottom border sits inside its border box.
    expect(laneBox.height).toBe(LANE_HEIGHT);
    expect(clipBox.height).toBe(CLIP_HEIGHT);
    // Its layout offset, since a selected clip is lifted 1px by a transform.
    expect(clip.offsetTop).toBe(CLIP_INSET);
    expect(labelBox.y).toBe(laneBox.y);
    expect(labelBox.height).toBe(laneBox.height);

    // A pending selection is drawn 2px outside the clip's top and bottom.
    const bounds = lane("2").getBoundingClientRect();
    const y = bounds.y + 20;
    await mouse.move(bounds.x + 120, y);
    await mouse.down();
    await mouse.move(bounds.x + 260, y, { steps: 4 });
    await mouse.up();
    await expect.poll(() => selections()).toHaveLength(1);
    const selection = selections()[0].getBoundingClientRect();
    expect(selection.y - bounds.y).toBe(CLIP_INSET - 2);
    expect(selection.height).toBe(CLIP_HEIGHT + 4);
  });
});
