import { describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import type { RenderResult } from "vitest-browser-react";
import {
  EDITOR_TEST_TIMEOUT,
  renderEditor,
} from "../../component-test/editor.tsx";
import {
  center,
  click,
  dblclick,
  drag,
  move,
} from "../../component-test/input.ts";
import { LoopStrip } from "./LoopStrip";

function query(selector: string) {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`${selector} is not rendered`);
  }
  return element;
}

function count(selector: string) {
  return document.querySelectorAll(selector).length;
}

function box(selector: string) {
  return query(selector).getBoundingClientRect();
}

function timecode() {
  return document.querySelectorAll(".timeline-toolbar__display > span")[1]
    ?.textContent;
}

function geometry() {
  const view = box(".timeline-scroll");
  const ruler = box(".ruler-row__content");
  const strip = box(".ruler-loop-strip");
  return { view, ruler, strip, y: strip.y + strip.height / 2 };
}

function dragX(fromX: number, toX: number, y: number) {
  return drag({ x: fromX, y }, { x: toX, y });
}

function loopEnds() {
  const region = query(".ruler-loop-region");
  return {
    startQ: Number(region.dataset.startQ),
    endQ: Number(region.dataset.endQ),
  };
}

function selectionEnds() {
  const selection = query(".ruler-loop-strip__selection");
  return {
    startQ: Number(selection.dataset.startQ),
    endQ: Number(selection.dataset.endQ),
  };
}

describe(LoopStrip, { timeout: EDITOR_TEST_TIMEOUT }, () => {
  // The loop strip along the bottom of the ruler: dragging there highlights
  // a playback selection without moving the playhead, a click clears it, and
  // the ruler above it still scrubs.
  describe("playback selection", () => {
    test("the loop strip sits along the ruler's bottom with its own look", async () => {
      await renderEditor({ reducedMotion: true });
      const { ruler, strip } = geometry();
      expect(strip.y + strip.height).toBeCloseTo(ruler.y + ruler.height, 0);
      // About as tall as the playhead diamond, below the timecodes.
      expect(strip.height).toBeGreaterThanOrEqual(14);
      expect(strip.height).toBeLessThanOrEqual(ruler.height * 0.45);
      // The full width inside the ruler content's 1px left border.
      expect(strip.width).toBeGreaterThanOrEqual(ruler.width - 1);

      const content = getComputedStyle(query(".ruler-row__content"));
      const loopStrip = getComputedStyle(query(".ruler-loop-strip"));
      expect(loopStrip.cursor).toBe("crosshair");
      expect(loopStrip.cursor).not.toBe(content.cursor);
      expect(loopStrip.backgroundColor).not.toBe(content.backgroundColor);
    });

    test("dragging in the loop strip highlights a range and keeps the playhead", async () => {
      await renderEditor({ reducedMotion: true });
      const before = timecode();
      const markerBefore = box(".timeline-playhead-marker");
      const { view, y } = geometry();
      const fromX = view.x + view.width * 0.7;
      const toX = view.x + view.width * 0.45;

      // Right to left: the selection still runs start to end.
      await dragX(fromX, toX, y);

      await expect.poll(() => count(".ruler-loop-strip__selection")).toBe(1);
      expect(count(".ruler-playback-selection")).toBe(1);
      const { startQ, endQ } = selectionEnds();
      expect(endQ).toBeGreaterThan(startQ);
      const selection = box(".ruler-loop-strip__selection");
      expect(selection.x).toBeGreaterThan(toX - 40);
      expect(selection.x + selection.width).toBeLessThan(fromX + 40);

      expect(timecode()).toBe(before);
      expect(box(".timeline-playhead-marker").x).toBe(markerBefore.x);
    });

    test("a click in the loop strip clears the selection", async () => {
      await renderEditor({ reducedMotion: true });
      const { view, y } = geometry();
      await dragX(view.x + view.width * 0.4, view.x + view.width * 0.6, y);
      await expect.poll(() => count(".ruler-loop-strip__selection")).toBe(1);

      await click(view.x + view.width * 0.8, y);
      await expect.poll(() => count(".ruler-loop-strip__selection")).toBe(0);
      expect(count(".ruler-playback-selection")).toBe(0);
    });

    test("dragging in the ruler above the strip still scrubs", async () => {
      await renderEditor({ reducedMotion: true });
      const before = timecode();
      const { view, ruler } = geometry();
      const y = ruler.y + ruler.height * 0.3;
      await dragX(view.x + view.width * 0.4, view.x + view.width * 0.6, y);

      await expect.poll(timecode).not.toBe(before);
      expect(count(".ruler-loop-strip__selection")).toBe(0);
    });
  });

  // The loop region in the ruler's loop strip: L locks a playback selection
  // into it, it resizes from its edges, moves from its middle and deletes on
  // a double-click, and the strip's right-click menu places its markers.
  describe("loop region", () => {
    // An item's name ends with its shortcut, if it has one.
    function menuItem(screen: RenderResult, name: string) {
      return screen.getByRole("menuitem", {
        name: new RegExp(`^${name}( |$)`),
      });
    }

    async function chooseFromMenu(
      screen: RenderResult,
      x: number,
      y: number,
      name: string,
    ) {
      await click(x, y, { button: "right" });
      const item = menuItem(screen, name);
      await expect.element(item).toBeVisible();
      await click(center(item.element()).x, center(item.element()).y);
      await expect
        .poll(() => screen.getByRole("menu").elements().length)
        .toBe(0);
    }

    test("L locks the selection into a loop that resizes, moves and deletes", async () => {
      await renderEditor({ reducedMotion: true });
      const { view, y } = geometry();

      // L with no playback selection does nothing.
      await userEvent.keyboard("l");
      expect(count(".ruler-loop-region")).toBe(0);

      await dragX(view.x + view.width * 0.3, view.x + view.width * 0.5, y);
      await expect.poll(() => count(".ruler-loop-strip__selection")).toBe(1);
      const selected = selectionEnds();

      await userEvent.keyboard("l");
      await expect.poll(() => count(".ruler-loop-region")).toBe(1);
      expect(count(".ruler-loop-strip__selection")).toBe(0);
      expect(count(".ruler-playback-selection")).toBe(0);
      expect(count(".ruler-loop-region__marker--in")).toBe(1);
      expect(count(".ruler-loop-region__marker--out")).toBe(1);
      expect(loopEnds()).toEqual(selected);

      // Only the hovered handle shows, with the clip trim cursor.
      const endHandle = ".ruler-loop-region__handle--end";
      const handleOpacity = (selector: string) =>
        Number(getComputedStyle(query(selector)).opacity);
      const end = center(query(endHandle));
      await move(end.x, end.y);
      await expect.poll(() => handleOpacity(endHandle)).toBeGreaterThan(0);
      expect(handleOpacity(".ruler-loop-region__handle--start")).toBe(0);
      expect(getComputedStyle(query(endHandle)).cursor).toBe("ew-resize");

      // Dragging the out marker's handle resizes only that end.
      await drag(end, { x: end.x + view.width * 0.1, y: end.y });
      const resized = loopEnds();
      expect(resized.startQ).toBe(selected.startQ);
      expect(resized.endQ).toBeGreaterThan(selected.endQ);

      // Dragging the in marker's handle past the out marker stops short of
      // it.
      const start = center(query(".ruler-loop-region__handle--start"));
      await drag(start, { x: start.x + view.width * 0.5, y: start.y });
      const clamped = loopEnds();
      expect(clamped.startQ).toBeLessThan(clamped.endQ);
      expect(clamped.endQ).toBe(resized.endQ);

      // Put the in marker back, then drag the middle: the loop keeps its
      // length.
      const narrowStart = center(query(".ruler-loop-region__handle--start"));
      await drag(narrowStart, { x: start.x, y: narrowStart.y });
      const beforeMove = loopEnds();
      const body = center(query(".ruler-loop-region__body"));
      await drag(body, { x: body.x - view.width * 0.1, y: body.y });
      const moved = loopEnds();
      expect(moved.startQ).toBeLessThan(beforeMove.startQ);
      expect(moved.endQ - moved.startQ).toBeCloseTo(
        beforeMove.endQ - beforeMove.startQ,
        6,
      );

      const movedBody = center(query(".ruler-loop-region__body"));
      await dblclick(movedBody.x, movedBody.y);
      await expect.poll(() => count(".ruler-loop-region")).toBe(0);
    });

    test("the loop strip menu places markers, locks a selection and deletes the loop", async () => {
      const screen = await renderEditor({ reducedMotion: true });
      const { view, y } = geometry();
      const timecodeBefore = timecode();

      await click(view.x + view.width * 0.6, y, { button: "right" });
      await expect
        .element(screen.getByRole("menu", { name: "Loop actions" }))
        .toBeVisible();
      await expect
        .element(menuItem(screen, "Create loop in marker"))
        .toBeVisible();
      await expect
        .element(menuItem(screen, "Create loop out marker"))
        .toBeVisible();
      await expect
        .element(menuItem(screen, "Create loop area"))
        .toHaveAttribute("aria-disabled", "true");
      await expect
        .element(menuItem(screen, "Delete loop"))
        .toHaveAttribute("aria-disabled", "true");

      // An out marker alone starts the loop at the timeline start.
      const outItem = menuItem(screen, "Create loop out marker").element();
      await click(center(outItem).x, center(outItem).y);
      await expect.poll(() => count(".ruler-loop-region")).toBe(1);
      const outOnly = loopEnds();
      expect(outOnly.startQ).toBe(0);
      expect(outOnly.endQ).toBeGreaterThan(0);

      // An in marker moves the start and keeps the end.
      await chooseFromMenu(
        screen,
        view.x + view.width * 0.4,
        y,
        "Create loop in marker",
      );
      const placed = loopEnds();
      expect(placed.startQ).toBeGreaterThan(0);
      expect(placed.endQ).toBe(outOnly.endQ);

      // Create loop area does what L does.
      await dragX(view.x + view.width * 0.7, view.x + view.width * 0.85, y);
      await expect.poll(() => count(".ruler-loop-strip__selection")).toBe(1);
      const selectedStartQ = selectionEnds().startQ;
      await chooseFromMenu(
        screen,
        view.x + view.width * 0.75,
        y,
        "Create loop area",
      );
      expect(count(".ruler-loop-strip__selection")).toBe(0);
      expect(loopEnds().startQ).toBe(selectedStartQ);

      await chooseFromMenu(screen, view.x + view.width * 0.2, y, "Delete loop");
      await expect.poll(() => count(".ruler-loop-region")).toBe(0);
      // Choosing items never scrubs the ruler under them.
      expect(timecode()).toBe(timecodeBefore);
    });

    test("Create loop in and out marker always make a full loop at the click", async () => {
      const screen = await renderEditor({ reducedMotion: true });
      const { view, strip, y } = geometry();
      // The visible part of the strip, right of the layer headers.
      const left = strip.x;
      const right = view.x + view.width;
      const at = (fraction: number) => left + (right - left) * fraction;
      const place = async (x: number, name: string) => {
        await chooseFromMenu(screen, x, y, name);
        await expect.poll(() => count(".ruler-loop-region")).toBe(1);
        return { ...loopEnds(), box: box(".ruler-loop-region") };
      };

      const outOnly = await place(
        view.x + view.width * 0.5,
        "Create loop out marker",
      );
      expect(outOnly.startQ).toBe(0);
      expect(outOnly.endQ).toBeGreaterThan(0);
      const quarterPx = outOnly.box.width / outOnly.endQ;
      const snapPx = quarterPx;

      // An in marker just before the out marker starts a full loop instead
      // of shrinking to a sliver against the out marker.
      const outX = outOnly.box.x + outOnly.box.width;
      const justBefore = await place(
        outX - quarterPx * 0.3,
        "Create loop in marker",
      );
      expect(justBefore.box.x + justBefore.box.width).toBeGreaterThanOrEqual(
        right - 1,
      );

      // An in marker past the out marker starts a loop at the click instead
      // of shrinking to a sliver at the out marker. The blank session's
      // content ends at bar 2, so the loop runs on to the timeline end.
      const inX = at(0.75);
      const pastOut = await place(inX, "Create loop in marker");
      expect(pastOut.startQ).toBeGreaterThan(outOnly.endQ);
      expect(Math.abs(pastOut.box.x - inX)).toBeLessThan(snapPx);
      expect(pastOut.box.x + pastOut.box.width).toBeGreaterThanOrEqual(
        right - 1,
      );

      // An out marker before the in marker runs the loop from the timeline
      // start.
      const beforeInX = at(0.25);
      const beforeIn = await place(beforeInX, "Create loop out marker");
      expect(beforeIn.startQ).toBe(0);
      expect(beforeIn.endQ).toBeLessThan(pastOut.startQ);
      expect(Math.abs(beforeIn.box.x - left)).toBeLessThan(1);
      expect(
        Math.abs(beforeIn.box.x + beforeIn.box.width - beforeInX),
      ).toBeLessThan(snapPx);

      // With no loop, an in marker before the content end runs to it.
      await chooseFromMenu(screen, at(0.5), y, "Delete loop");
      await expect.poll(() => count(".ruler-loop-region")).toBe(0);
      const beforeEnd = await place(
        strip.x + quarterPx * 1.1,
        "Create loop in marker",
      );
      expect(beforeEnd.startQ).toBe(1);
      expect(beforeEnd.endQ).toBe(4);
      expect(beforeEnd.box.width).toBeCloseTo(3 * quarterPx, 0);
    });
  });
});
