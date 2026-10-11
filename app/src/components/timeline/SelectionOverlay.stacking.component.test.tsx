import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import "./SelectionOverlay";
import {
  EDITOR_TEST_TIMEOUT,
  renderEditor,
  sessionWithLayers,
  withTestPatternTrack,
} from "../../component-test/editor.tsx";
import { click, down, move, up } from "../../component-test/input.ts";

// The timeline range selection renders before a lane's clips but paints over
// them, so a range on a layer that already has clips stays visible. Clicks
// inside it keep it; the clips take clicks outside it. A four-second test
// pattern at 120 BPM spans eight quarters. SelectionOverlay and ClipCard
// draw them; the editor harness wires the timeline as App does.

function lane(id: string) {
  const element = document.querySelector<HTMLElement>(
    `[data-timeline-lane-id="${id}"]`,
  );
  if (!element) {
    throw new Error(`Layer ${id} is not rendered`);
  }
  return element;
}

function clipIn(laneId: string) {
  const clip = lane(laneId).querySelector<HTMLElement>(".clip-card");
  if (!clip) {
    throw new Error(`Layer ${laneId} has no clip`);
  }
  return clip;
}

function selectionCount(laneId: string) {
  return lane(laneId).querySelectorAll(".timeline-selection").length;
}

function isSelected(clip: Element) {
  return clip.classList.contains("clip-card--selected");
}

// The selected clip's neutral ring and stacking, read from computed style.
function ringOf(clip: Element) {
  const style = getComputedStyle(clip);
  return {
    outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
    zIndex: style.zIndex,
  };
}

const RING = "solid 2px rgb(244, 246, 255)";

// Copies the source clip to `layer` from its menu.
async function copySpanToLayer(layer: string) {
  const span = document.querySelector(".source-span");
  if (!span) {
    throw new Error("No source clip");
  }
  await userEvent.click(page.elementLocator(span), { button: "right" });
  await userEvent.hover(page.getByRole("menuitem", { name: "Copy to layer" }));
  await userEvent.click(page.getByRole("menuitem", { name: layer }));
}

describe("SelectionOverlay stacking in the editor", {
  timeout: EDITOR_TEST_TIMEOUT,
}, () => {
  test("a range selection paints over the clips it overlaps", async () => {
    // Layers "1" and "2", and the test pattern in a new source track.
    await renderEditor({
      project: withTestPatternTrack(sessionWithLayers(2)),
    });
    await expect
      .poll(() => document.querySelectorAll(".source-span").length)
      .toBe(1);

    await copySpanToLayer("Layer 1");
    await expect
      .poll(() => lane("1").querySelectorAll(".clip-card").length)
      .toBe(1);
    const clip = clipIn("1");
    // A lone clip always counts as selected, so add a second one to tell a
    // click on the first apart.
    await copySpanToLayer("Layer 2");
    await expect.poll(() => isSelected(clipIn("2"))).toBe(true);
    const other = clipIn("2");
    const otherRing = ringOf(other);
    expect(otherRing.outline).toBe(RING);
    expect(ringOf(clip).outline).toMatch(/^none /);
    clip.scrollIntoView({ block: "center" });

    // Drag from the empty lane after the clip back across it.
    const clipBox = clip.getBoundingClientRect();
    const laneBox = lane("1").getBoundingClientRect();
    const y = laneBox.y + laneBox.height / 2;
    const fromX = clipBox.x + clipBox.width + 60;
    const toX = clipBox.x + clipBox.width / 3;
    await move(fromX, y);
    await down();
    await move((fromX + toX) / 2, y);
    await move(toX, y);
    await up();

    await expect.poll(() => selectionCount("1")).toBe(1);
    const selection = lane("1").querySelector(
      ".timeline-selection",
    ) as HTMLElement;
    const selectionBox = selection.getBoundingClientRect();
    expect(selectionBox.x).toBeLessThan(clipBox.x + clipBox.width);

    // The selection stacks above the clip card, which is isolated at the loop
    // overlay's depth.
    const selectionZ = Number(getComputedStyle(selection).zIndex);
    const clipZ = Number(getComputedStyle(clip).zIndex);
    const playhead = document.querySelector(".timeline-playhead") as Element;
    const playheadZ = Number(getComputedStyle(playhead).zIndex);
    expect(clipZ).toBeGreaterThan(0);
    expect(clipZ).toBeLessThan(selectionZ);
    expect(selectionZ).toBeLessThan(playheadZ);
    // The selected clip rises above its neighbors but stays under the range.
    expect(Number(otherRing.zIndex)).toBeGreaterThan(clipZ);
    expect(Number(otherRing.zIndex)).toBeLessThan(selectionZ);

    // A click inside the selection keeps it rather than reaching the clip
    // under it (#918).
    const inside = (selectionBox.x + clipBox.x + clipBox.width) / 2;
    const middle = clipBox.y + clipBox.height / 2;
    expect(
      document.elementFromPoint(inside, middle)?.closest(".timeline-selection"),
    ).toBe(selection);
    await click(inside, middle);
    expect(selectionCount("1")).toBe(1);
    expect(isSelected(clip)).toBe(false);

    // The part of the clip outside it takes the click and clears it.
    await click((clipBox.x + selectionBox.x) / 2, middle);
    await expect.poll(() => selectionCount("1")).toBe(0);
    await expect.poll(() => isSelected(clip)).toBe(true);
    expect(isSelected(other)).toBe(false);
    expect(ringOf(clip).outline).toBe(RING);
    expect(ringOf(other).outline).toMatch(/^none /);
  });
});
