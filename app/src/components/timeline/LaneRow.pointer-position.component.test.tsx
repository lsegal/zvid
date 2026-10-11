import { describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { renderTimelineEditor } from "../../component-test/timeline-editor.tsx";
import {
  down,
  holdModifiers,
  move,
  up,
} from "../../component-test/timeline-mouse.ts";
import { setViewport } from "../../component-test/viewport.ts";
import { LaneRow } from "./LaneRow";

describe(LaneRow, () => {
  // The timeline position under the pointer is measured from where clips
  // start, inside the timeline scroller's border and the content's left
  // border, so an unsnapped selection lands right under the pointer (#696).
  test("an unsnapped lane selection starts and ends under the pointer", async () => {
    await setViewport({ width: 1280, height: 900 });
    await renderTimelineEditor({ reducedMotion: true });
    const target = document.querySelector(
      '[data-timeline-lane-id="1"]',
    ) as HTMLElement;
    const bounds = target.getBoundingClientRect();
    // The client x where the lane's timeline starts, inside its left border.
    const origin = bounds.left + target.clientLeft;
    const y = bounds.y + 20;
    const fromX = origin + 40.5;
    const toX = origin + 260.5;

    // Shift turns snapping off for the drag.
    await userEvent.keyboard("{Shift>}");
    holdModifiers(["Shift"]);
    await move(fromX, y);
    await down();
    await move(origin + 150, y, { steps: 4 });
    await move(toX, y, { steps: 4 });
    await up();
    holdModifiers([]);
    await userEvent.keyboard("{/Shift}");

    await expect
      .poll(() => document.querySelectorAll(".timeline-selection").length)
      .toBe(1);
    const selection = (
      document.querySelector(".timeline-selection") as HTMLElement
    ).getBoundingClientRect();
    expect(Math.abs(selection.x - fromX)).toBeLessThan(0.5);
    expect(Math.abs(selection.x + selection.width - toX)).toBeLessThan(0.5);
  });
});
