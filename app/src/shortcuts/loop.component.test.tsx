import { beforeEach, describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import {
  EDITOR_TEST_TIMEOUT,
  renderEditor,
} from "../component-test/editor.tsx";
import { down, move, pressMod, up } from "../component-test/input.ts";
import { setViewport } from "../component-test/viewport.ts";

// Ctrl/Cmd+L loops the timeline selection, or clears the loop when nothing
// is selected (#1385).

const loopRegion = () =>
  document.querySelector(".ruler-loop-region") as HTMLElement | null;

// Drags from `fromX` to `toX`, client x, across the middle of `element`.
async function dragAcross(element: Element, fromX: number, toX: number) {
  const bounds = element.getBoundingClientRect();
  const y = bounds.y + bounds.height / 2;
  await move(fromX, y);
  await down();
  await move((fromX + toX) / 2, y);
  await move(toX, y);
  await up();
}

describe("loop shortcuts", { timeout: EDITOR_TEST_TIMEOUT }, () => {
  beforeEach(async () => {
    await setViewport({ width: 1600, height: 1200 });
  });

  test("Ctrl/Cmd+L loops the lane selection and clears the loop without one", async () => {
    await renderEditor();
    const lane = document.querySelector(
      '[data-timeline-lane-id="1"]',
    ) as HTMLElement;
    const laneBox = lane.getBoundingClientRect();
    await dragAcross(lane, laneBox.x + 40, laneBox.x + 240);
    await expect
      .poll(() => lane.querySelector(".timeline-selection"))
      .not.toBeNull();
    const selectionBox = (
      lane.querySelector(".timeline-selection") as HTMLElement
    ).getBoundingClientRect();

    await pressMod("l");
    await expect.poll(loopRegion).not.toBeNull();
    const regionBox = (loopRegion() as HTMLElement).getBoundingClientRect();
    expect(regionBox.x).toBeCloseTo(selectionBox.x, 0);
    expect(regionBox.width).toBeCloseTo(selectionBox.width, 0);

    // Plain L still needs a playback selection, so it leaves the loop alone.
    await userEvent.keyboard("l");
    expect(loopRegion()).not.toBeNull();

    await userEvent.keyboard("{Escape}");
    await expect
      .poll(() => lane.querySelector(".timeline-selection"))
      .toBeNull();
    await pressMod("l");
    await expect.poll(loopRegion).toBeNull();
  });

  test("Ctrl/Cmd+L locks the loop strip's playback selection into the loop", async () => {
    await renderEditor();
    const strip = document.querySelector(".ruler-loop-strip") as HTMLElement;
    const stripBox = strip.getBoundingClientRect();
    await dragAcross(strip, stripBox.x + 60, stripBox.x + 300);
    await expect
      .poll(() => document.querySelector(".ruler-playback-selection"))
      .not.toBeNull();

    await pressMod("l");
    await expect.poll(loopRegion).not.toBeNull();
    expect(document.querySelector(".ruler-playback-selection")).toBeNull();
  });
});
