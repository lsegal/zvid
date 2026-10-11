import { describe, expect, onTestFinished, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  renderTimelineEditor,
  TIMELINE_EDITOR_TIMEOUT,
} from "../../component-test/timeline-editor.tsx";
import {
  click,
  down,
  type MouseButton,
  move,
  up,
} from "../../component-test/timeline-mouse.ts";
import { setViewport } from "../../component-test/viewport.ts";
import { Ruler } from "./Ruler";

function query(selector: string) {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`${selector} is not rendered`);
  }
  return element;
}

function box(selector: string) {
  return query(selector).getBoundingClientRect();
}

function timecode() {
  return document.querySelectorAll(".timeline-toolbar__display > span")[1]
    ?.textContent;
}

describe(Ruler, { timeout: TIMELINE_EDITOR_TIMEOUT }, () => {
  // Hand-grab panning on the timeline ruler: the right and middle buttons pan
  // the timeline, a right-drag up or down zooms around the pointer, the left
  // button only scrubs the playhead, and the browser's context menu never
  // opens there.
  describe("hand-grab panning", () => {
    function timelineState() {
      const zoom = query('input[aria-label="Timeline zoom"]');
      const scroll = query(".timeline-scroll");
      const marker = query(".timeline-playhead-marker");
      const content = query(".ruler-row__content");
      return {
        zoom: Number(zoom.dataset.zoom),
        contentLeft: content.getBoundingClientRect().left,
        scrollLeft: scroll.scrollLeft,
        maxScrollLeft: scroll.scrollWidth - scroll.clientWidth,
        // The playhead's position within the timeline, independent of
        // scroll.
        playheadX:
          marker.getBoundingClientRect().left -
          content.getBoundingClientRect().left,
      };
    }

    // A point on the visible part of the ruler, which is wider than the
    // view.
    function rulerPoint() {
      const view = box(".timeline-scroll");
      const ruler = box(".ruler-row__content");
      return { x: view.x + view.width * 0.6, y: ruler.y + ruler.height / 2 };
    }

    // The timeline time at viewport x, in pixels at 100% zoom.
    function timeAt(state: { zoom: number; contentLeft: number }, x: number) {
      return (x - state.contentLeft) / state.zoom;
    }

    async function drag(
      button: MouseButton,
      from: { x: number; y: number },
      dx: number,
      dy = 0,
    ) {
      await move(from.x, from.y);
      await down({ button });
      await move(from.x + dx, from.y + dy, { steps: 12 });
      await up({ button });
    }

    // Whether the Edit menu's Undo is disabled.
    async function expectUndoDisabled(disabled: boolean) {
      await userEvent.click(
        page.getByRole("menuitem", { name: "Edit", exact: true }),
      );
      const undo = page.getByRole("menuitem", { name: /^Undo/ });
      await expect.element(undo).toBeVisible();
      // Radix leaves aria-disabled off enabled items.
      if (disabled) {
        await expect.element(undo).toHaveAttribute("aria-disabled", "true");
      } else {
        await expect.element(undo).not.toHaveAttribute("aria-disabled");
      }
      await userEvent.keyboard("{Escape}");
      await expect.poll(() => page.getByRole("menu").elements()).toEqual([]);
    }

    // Records whether each contextmenu event reaching the window was
    // canceled, which is what keeps the browser's own menu closed.
    async function renderWatchingContextMenus() {
      const screen = await renderTimelineEditor({
        // No momentum, so the pan lands exactly where the pointer let go.
        reducedMotion: true,
      });
      const contextMenus: boolean[] = [];
      const record = (event: Event) =>
        contextMenus.push(event.defaultPrevented);
      window.addEventListener("contextmenu", record);
      onTestFinished(() => window.removeEventListener("contextmenu", record));
      return { screen, contextMenus };
    }

    test("right-dragging the ruler pans the timeline without moving the playhead", async () => {
      const { contextMenus } = await renderWatchingContextMenus();
      const before = timelineState();
      expect(before.maxScrollLeft).toBeGreaterThan(200);

      const from = rulerPoint();
      const row = query(".ruler-row");
      await move(from.x, from.y);
      await down({ button: "right" });
      await move(from.x - 100, from.y, { steps: 6 });
      await expect.poll(() => row.className).toMatch(/is-grab-panning/);
      expect(getComputedStyle(row).cursor).toBe("grabbing");
      await move(from.x - 200, from.y, { steps: 6 });
      await up({ button: "right" });

      const after = timelineState();
      expect(after.scrollLeft).toBe(before.scrollLeft + 200);
      expect(after.playheadX).toBeCloseTo(before.playheadX, 0);
      await expect.poll(() => row.className).not.toMatch(/is-grab-panning/);
      expect(contextMenus).not.toContain(false);

      // Dragging back the other way pans back.
      await drag("right", from, 150);
      expect(timelineState().scrollLeft).toBe(after.scrollLeft - 150);
    });

    test("a right-click on the ruler without a drag does nothing and shows no browser menu", async () => {
      const { contextMenus } = await renderWatchingContextMenus();
      const before = timelineState();
      const from = rulerPoint();
      await click(from.x, from.y, { button: "right" });

      const after = timelineState();
      expect(after.scrollLeft).toBe(before.scrollLeft);
      expect(after.playheadX).toBeCloseTo(before.playheadX, 0);
      expect(contextMenus.length).toBeGreaterThan(0);
      expect(contextMenus).not.toContain(false);
    });

    test("middle-dragging the ruler pans too", async () => {
      await renderWatchingContextMenus();
      const before = timelineState();
      await drag("middle", rulerPoint(), -180);

      const after = timelineState();
      expect(after.scrollLeft).toBe(before.scrollLeft + 180);
      expect(after.playheadX).toBeCloseTo(before.playheadX, 0);
    });

    test("left-dragging the ruler still scrubs the playhead", async () => {
      await renderWatchingContextMenus();
      const before = timelineState();
      await drag("left", rulerPoint(), -120);

      const after = timelineState();
      expect(after.scrollLeft).toBe(before.scrollLeft);
      expect(after.playheadX).not.toBeCloseTo(before.playheadX, 0);
    });

    test("left-dragging the ruler up or down scrubs without zooming", async () => {
      await renderWatchingContextMenus();
      const before = timelineState();
      const from = rulerPoint();
      await drag("left", from, -80, -150);

      let after = timelineState();
      expect(after.zoom).toBe(before.zoom);
      expect(after.scrollLeft).toBe(before.scrollLeft);
      expect(after.playheadX).not.toBeCloseTo(before.playheadX, 0);

      await drag("left", from, 40, 150);
      after = timelineState();
      expect(after.zoom).toBe(before.zoom);
    });

    test("right-dragging the ruler up zooms in around the pointer without moving the playhead", async () => {
      const { contextMenus } = await renderWatchingContextMenus();
      await expectUndoDisabled(true);
      const before = timelineState();
      const from = rulerPoint();
      const row = query(".ruler-row");
      await move(from.x, from.y);
      await down({ button: "right" });
      await move(from.x, from.y - 60, { steps: 6 });
      await expect.poll(() => row.className).toMatch(/is-grab-panning/);
      await move(from.x, from.y - 100, { steps: 6 });
      await up({ button: "right" });

      await expect.poll(() => timelineState().zoom).not.toBe(before.zoom);
      const after = timelineState();
      // 75px past the 25px threshold scales by e^0.004 per pixel.
      expect(after.zoom).toBeCloseTo(before.zoom * Math.exp(75 * 0.004), 2);
      expect(timeAt(after, from.x)).toBeCloseTo(timeAt(before, from.x), 0);
      expect(after.playheadX / after.zoom).toBeCloseTo(
        before.playheadX / before.zoom,
        0,
      );
      expect(contextMenus).not.toContain(false);

      // The whole drag is one undo step.
      await expectUndoDisabled(false);
      await userEvent.keyboard("{Control>}z{/Control}");
      await expect.poll(() => timelineState().zoom).toBe(before.zoom);
      await expectUndoDisabled(true);
    });

    test("a diagonal right-drag pans and zooms at once, keeping the grabbed time under the pointer", async () => {
      await renderWatchingContextMenus();
      const before = timelineState();
      const from = rulerPoint();
      const grabbed = timeAt(before, from.x);
      await drag("right", from, -120, 80);

      await expect.poll(() => timelineState().zoom).not.toBe(before.zoom);
      const after = timelineState();
      // 55px past the threshold downward zooms out.
      expect(after.zoom).toBeCloseTo(before.zoom * Math.exp(-55 * 0.004), 2);
      expect(timeAt(after, from.x - 120)).toBeCloseTo(grabbed, 0);
      expect(after.playheadX / after.zoom).toBeCloseTo(
        before.playheadX / before.zoom,
        0,
      );
    });

    test("a right-drag within the vertical threshold only pans", async () => {
      await renderWatchingContextMenus();
      const before = timelineState();
      await drag("right", rulerPoint(), -150, 20);

      const after = timelineState();
      expect(after.zoom).toBe(before.zoom);
      expect(after.scrollLeft).toBe(before.scrollLeft + 150);
    });

    test("middle-dragging the ruler up or down doesn't zoom", async () => {
      await renderWatchingContextMenus();
      const before = timelineState();
      await drag("middle", rulerPoint(), -100, -150);

      const after = timelineState();
      expect(after.zoom).toBe(before.zoom);
      expect(after.scrollLeft).toBe(before.scrollLeft + 100);
    });

    test("releasing a right-drag over a lane opens no menu", async () => {
      const { screen, contextMenus } = await renderWatchingContextMenus();
      const from = rulerPoint();
      const target = box('[data-timeline-lane-id="1"]');
      await drag("right", from, -150, target.y + target.height / 2 - from.y);

      expect(screen.getByRole("menu").elements()).toEqual([]);
      expect(contextMenus).not.toContain(false);

      // The next right-click on the lane opens its menu as usual.
      const lane = box('[data-timeline-lane-id="1"]');
      await click(lane.x + lane.width / 2, lane.y + lane.height / 2, {
        button: "right",
      });
      await expect.element(screen.getByRole("menu")).toBeVisible();
    });
  });

  // Scrubbing the playhead from the ruler left past 00:00:00, over the track
  // label column, stops the playhead at 0 and never scrolls the timeline
  // right.
  describe("scrubbing past the start", () => {
    // Records every timeline scroll position from now on.
    function watchScroll() {
      const scroll = query(".timeline-scroll");
      const positions = [scroll.scrollLeft];
      scroll.addEventListener("scroll", () =>
        positions.push(scroll.scrollLeft),
      );
      return positions;
    }

    async function scrubToLabels() {
      const view = box(".timeline-scroll");
      const ruler = box(".ruler-row__content");
      const y = ruler.y + ruler.height / 2;
      await move(view.x + view.width * 0.6, y);
      await down();
      // Past the start of the lanes, then across the label column to the
      // timeline's left edge.
      await move(view.x + 2, y, { steps: 30 });
      await up();
    }

    function expectNeverIncreases(values: number[]) {
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeLessThanOrEqual(values[i - 1]);
      }
    }

    test("scrubbing left past 00:00:00 leaves the view at the start", async () => {
      await renderTimelineEditor({ reducedMotion: true });
      expect(query(".timeline-scroll").scrollLeft).toBe(0);
      const positions = watchScroll();
      await scrubToLabels();

      expectNeverIncreases(positions);
      expect(positions.at(-1)).toBe(0);
      await expect.poll(timecode).toBe("00:00:00");
    });

    test("scrubbing left past 00:00:00 from a scrolled view only scrolls left", async () => {
      await renderTimelineEditor({ reducedMotion: true });
      // Scrolled by less than the label column, so a drag to the timeline's
      // left edge carries the playhead past 00:00:00.
      const scroll = query(".timeline-scroll");
      const labelWidth =
        box(".ruler-row__content").left - scroll.getBoundingClientRect().left;
      scroll.scrollLeft = Math.floor(labelWidth / 2);
      expect(scroll.scrollLeft).toBeGreaterThan(0);
      const positions = watchScroll();
      await scrubToLabels();

      await expect.poll(() => positions.at(-1)).toBe(0);
      expectNeverIncreases(positions);
      await expect.poll(timecode).toBe("00:00:00");
    });
  });

  // The playhead is two lines: the marker in the ruler and the line through
  // the layers below it. They must meet at the ruler's bottom edge with no
  // gap, also when the header label cell makes the ruler row taller (#938).
  describe("the playhead marker", () => {
    // Seeks by clicking empty space in Layer 1's lane, 300px into it.
    async function seek() {
      const lane = box('[data-timeline-lane-id="1"]');
      const marker = query(".timeline-playhead-marker");
      const before = marker.style.transform;
      await click(lane.x + 300, lane.y + 20);
      await expect.poll(() => marker.style.transform).not.toBe(before);
    }

    // Where the ruler marker ends, where the ruler row ends, and the first y
    // below the ruler at which the layers' playhead line paints topmost. The
    // line ignores pointer events, so turn them on to let elementFromPoint
    // see it.
    function playheadJoin() {
      const style = document.createElement("style");
      style.textContent =
        ".timeline-playhead { pointer-events: auto !important; }";
      document.head.append(style);
      try {
        const markerBox = box(".timeline-playhead-marker");
        const lineBox = box(".timeline-playhead");
        const rowBottom = box(".ruler-row").bottom;
        const x = lineBox.left + lineBox.width / 2;
        let lineTop = Number.NaN;
        for (let y = Math.floor(rowBottom); y < rowBottom + 80; y += 1) {
          if (document.elementFromPoint(x, y)?.closest(".timeline-playhead")) {
            lineTop = y;
            break;
          }
        }
        return {
          markerX: markerBox.left + markerBox.width / 2,
          lineX: x,
          markerBottom: markerBox.bottom,
          rowBottom,
          lineTop,
        };
      } finally {
        style.remove();
      }
    }

    function expectContinuousPlayhead() {
      const join = playheadJoin();
      expect(join.markerX).toBeCloseTo(join.lineX, 0);
      expect(join.markerBottom).toBeCloseTo(join.rowBottom, 0);
      expect(join.lineTop - join.markerBottom).toBeLessThanOrEqual(1);
    }

    test("the ruler marker meets the playhead line", async () => {
      await setViewport({ width: 1600, height: 1200 });
      await renderTimelineEditor();
      await seek();

      expectContinuousPlayhead();
    });

    test("the ruler marker meets the playhead line under a header status line", async () => {
      await setViewport({ width: 1600, height: 1200 });
      await renderTimelineEditor();
      const before = box(".ruler-row").height;

      // Stand in for the offline/sync status, plus a second line so the
      // label cell sets the row's height.
      const status = document.createElement("button");
      status.className = "track-label__offline";
      status.type = "button";
      status.textContent = "2 offline media files";
      query(".ruler-row .track-label--header > div").append(
        status,
        document.createElement("br"),
        "Syncing",
      );
      expect(box(".ruler-row").height).toBeGreaterThan(before);

      await seek();
      expectContinuousPlayhead();
    });
  });

  // The timeline position under the pointer is measured from where clips
  // start, inside the timeline scroller's border and the content's left
  // border, so an unsnapped scrub lands right under the pointer (#696).
  test("clicking the ruler puts the playhead under the pointer", async () => {
    await setViewport({ width: 1280, height: 900 });
    await renderTimelineEditor({ reducedMotion: true });
    const ruler = query(".ruler-row__content");
    const pointerX =
      ruler.getBoundingClientRect().left + ruler.clientLeft + 160;
    const rulerBox = ruler.getBoundingClientRect();
    await click(pointerX, rulerBox.y + rulerBox.height / 2);

    // The playhead's right edge marks its position.
    await expect
      .poll(() => Math.abs(box(".timeline-playhead-marker").right - pointerX))
      .toBeLessThan(0.5);
  });
});
