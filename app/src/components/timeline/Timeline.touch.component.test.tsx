import { describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { usePhone, useTablet } from "../../component-test/viewport.ts";
import {
  AUDIO_VIDEO,
  addClip,
  boxOf,
  centerOf,
  click,
  drag,
  findByRole,
  hold,
  isVisible,
  PLAYWRIGHT_TEST_TIMEOUT,
  playheadQ,
  query,
  renderApp,
  settledPlayheadQ,
  tap,
  timelineEdges,
  touch,
  visibleByRole,
  wait,
} from "../../mobile/phone-app-test-utils.tsx";
import { Timeline } from "./Timeline";

// The phone's timeline by touch (#1168): swipes scrub under a centered
// playhead, pinches zoom, taps select and holds draw or move. These mount
// the whole editor, since a touch edits the session and moves the
// playhead; they get the e2e specs' time to run.

const clipCount = () => document.querySelectorAll(".clip-card").length;
const selection = () => document.querySelector(".timeline-selection");

// The finest grid the lane draws, in px.
function gridCellPx(lane: Element) {
  const sizes = getComputedStyle(lane).backgroundSize.split(",");
  return Number.parseFloat(sizes[sizes.length - 1]);
}

// The vertical middle of Layer 1's lane.
function laneMiddleY() {
  const lane = boxOf('[data-timeline-lane-id="1"]');
  return lane.y + lane.height / 2;
}

describe(`${Timeline.name} on a phone`, {
  timeout: PLAYWRIGHT_TEST_TIMEOUT,
}, () => {
  test("the playhead stays centered while a swipe scrubs", async () => {
    await usePhone();
    await renderApp();
    await addClip();
    const scroll = centerOf(".timeline-scroll");
    const clipBefore = boxOf(".clip-card");
    const y = centerOf(".clip-card").y;
    // Starting on the clip, which a swipe scrolls past instead of moving.
    await drag({ x: scroll.x + 100, y }, { x: scroll.x - 60, y });
    await expect.poll(playheadQ).toBeGreaterThan(1);
    const line = boxOf(".timeline-playhead-marker").left;
    const view = boxOf(".timeline-scroll");
    expect(Math.abs(line - (view.left + view.width / 2))).toBeLessThan(4);
    // The clip scrolled with the timeline, and kept its time.
    const clipAfter = boxOf(".clip-card");
    const scrolled = query(".timeline-scroll").scrollLeft;
    expect(Math.abs(clipAfter.x + scrolled - clipBefore.x)).toBeLessThan(2);
  });

  // #1204: time 0 hugs the labels, with no lead-in before it. From there a
  // swipe moves the playhead to the center, and only then scrolls.
  test("the timeline starts at the labels, and the playhead moves to the center from there", async () => {
    await usePhone();
    await renderApp();
    await addClip();
    await userEvent.keyboard("{Escape}");
    const start = timelineEdges();
    // Within the lane's 1px border.
    expect(Math.abs(start.lane - start.labels)).toBeLessThanOrEqual(1);
    expect(Math.abs(start.line - start.labels)).toBeLessThan(4);
    expect(Math.abs(boxOf(".clip-card").x - start.labels)).toBeLessThan(4);
    expect(start.scrollLeft).toBe(0);

    const scroll = centerOf(".timeline-scroll");
    const y = centerOf(".clip-card").y;
    // A short swipe left moves the playhead, not the timeline.
    await drag({ x: scroll.x + 60, y }, { x: scroll.x + 20, y });
    await expect.poll(playheadQ).toBeGreaterThan(0);
    const moved = timelineEdges();
    expect(moved.scrollLeft).toBe(0);
    expect(moved.line - start.line).toBeGreaterThan(30);
    expect(moved.line - start.line).toBeLessThan(50);

    // A longer one carries it to the center, and the timeline scrolls on.
    await drag({ x: scroll.x + 100, y }, { x: scroll.x - 100, y });
    await expect.poll(() => timelineEdges().scrollLeft).toBeGreaterThan(0);
    const centered = timelineEdges();
    expect(Math.abs(centered.line - centered.center)).toBeLessThan(4);

    // Swiping all the way back brings it to time 0 at the labels' edge.
    await settledPlayheadQ();
    await drag({ x: scroll.x - 120, y }, { x: scroll.x + 150, y });
    await drag({ x: scroll.x - 120, y }, { x: scroll.x + 150, y });
    await expect.poll(playheadQ).toBe(0);
    const back = timelineEdges();
    expect(back.scrollLeft).toBe(0);
    expect(Math.abs(back.line - back.labels)).toBeLessThan(4);

    // Playback from 0 moves the playhead to the center, then scrolls.
    await click("button", "Play", { exact: true });
    await expect
      .poll(() => timelineEdges().scrollLeft, { timeout: 10_000 })
      .toBeGreaterThan(0);
    const playing = timelineEdges();
    expect(Math.abs(playing.line - playing.center)).toBeLessThan(6);
  });

  // The lanes show from the labels' edge, so the Audio row's waveform starts
  // there too (#1194).
  test("the Audio row's waveform reaches the labels' edge when scrolled", async () => {
    await usePhone();
    await renderApp();
    await addClip(AUDIO_VIDEO);
    const canvas = () =>
      document.querySelector("[data-audio-row] .waveform__canvas");
    await expect
      .poll(() => isVisible(canvas()), { timeout: 30_000 })
      .toBe(true);
    // Two seconds in: the center playhead sits inside the clip.
    query(".timeline-scroll").scrollLeft = 160;
    // Within the lane's 1px border.
    await expect
      .poll(() => {
        const canvasBox = canvas()?.getBoundingClientRect();
        const labelBox = boxOf("[data-audio-row] .track-label");
        return (
          (canvasBox?.x ?? Number.POSITIVE_INFINITY) -
          (labelBox.x + labelBox.width)
        );
      })
      .toBeLessThanOrEqual(1);
  });

  test("pinching zooms the timeline", async () => {
    await usePhone();
    await renderApp();
    await addClip();
    const before = boxOf(".clip-card").width;
    const { x, y } = centerOf(".timeline-scroll");
    await touch("touchStart", [
      { x: x - 30, y },
      { x: x + 30, y },
    ]);
    for (let step = 1; step <= 10; step += 1) {
      await touch("touchMove", [
        { x: x - 30 - step * 6, y },
        { x: x + 30 + step * 6, y },
      ]);
    }
    await touch("touchEnd", []);
    await expect
      .poll(() => boxOf(".clip-card").width)
      .toBeGreaterThan(before * 1.5);
  });

  test("a tap shows the selection toolbar and Split cuts at the center", async () => {
    await usePhone();
    await renderApp();
    await addClip();
    const scroll = centerOf(".timeline-scroll");
    const y = centerOf(".clip-card").y;
    await drag({ x: scroll.x + 60, y }, { x: scroll.x - 60, y });
    await expect.poll(playheadQ).toBeGreaterThan(1);
    await tap(query(".clip-card__body"));
    const toolbar = await findByRole("toolbar", "Clip actions");
    await click("button", "Split at playhead", { root: toolbar });
    await expect.poll(clipCount).toBe(2);
    // Tapping empty space drops the selection and the toolbar.
    const lane = boxOf('[data-timeline-lane-id="1"]');
    await hold({ x: scroll.x * 2 - 8, y: lane.y + lane.height - 6 }, 50);
    await expect.poll(() => isVisible(toolbar)).toBe(false);
  });

  test("a long press opens the clip menu as a sheet; hold and drag moves", async () => {
    await usePhone();
    await renderApp();
    await addClip();
    const clip = centerOf(".clip-card");
    await hold(clip);
    const sheet = await findByRole("menu", "Clip actions");
    await findByRole("menuitem", "Duplicate", { root: sheet });
    await click("button", "Close menu");
    await expect.poll(() => isVisible(sheet)).toBe(false);

    const before = boxOf(".clip-card");
    await drag(clip, { x: clip.x + 80, y: clip.y }, 600);
    await expect
      .poll(() => boxOf(".clip-card").x)
      .toBeGreaterThan(before.x + 40);
  });

  // #1179: a swipe on empty lane space scrolls, so a hold starts a selection.
  test("a long press and drag on empty lane space selects a range", async () => {
    await usePhone();
    await renderApp();
    const scroll = centerOf(".timeline-scroll");
    const y = laneMiddleY();

    // A plain swipe still scrubs and draws nothing.
    await drag({ x: scroll.x + 60, y }, { x: scroll.x - 60, y });
    await expect.poll(playheadQ).toBeGreaterThan(1);
    expect(selection()).toBeNull();

    const before = await settledPlayheadQ();
    await drag({ x: scroll.x, y }, { x: scroll.x + 120, y }, 600);
    await expect.poll(() => isVisible(selection())).toBe(true);
    const toolbar = await findByRole("toolbar", "Selection actions");
    // The hold drew instead of scrolling, so the playhead stayed put.
    expect(playheadQ()).toBe(before);
    const drawn = boxOf(".timeline-selection");
    expect(drawn.width).toBeGreaterThan(80);

    // The end handle has a 44px target and stretches the selection.
    const end = (
      await findByRole("button", "Resize selection end")
    ).getBoundingClientRect();
    expect(end.width).toBe(44);
    const endAt = { x: end.x + end.width / 2, y: end.y + end.height / 2 };
    await drag(endAt, { x: endAt.x + 60, y: endAt.y });
    await expect
      .poll(() => boxOf(".timeline-selection").width)
      .toBeGreaterThan(drawn.width + 30);

    // A swipe keeps it; a tap on it opens its menu as a sheet.
    await drag({ x: scroll.x - 40, y }, { x: scroll.x + 40, y });
    await settledPlayheadQ();
    expect(isVisible(selection())).toBe(true);
    const fill = await findByRole("button", "Insert Fill Clip", {
      root: toolbar,
    });
    expect(fill.matches(":disabled")).toBe(false);
    await tap(query(".timeline-selection"));
    const sheet = await findByRole("menu", "Selection actions");
    await findByRole("menuitem", "Insert Track", { root: sheet });
    await click("menuitem", "Insert Fill Clip", { root: sheet });
    await expect.poll(() => isVisible(sheet)).toBe(false);
    await expect.poll(clipCount).toBe(1);
  });

  test("tapping elsewhere clears a lane selection", async () => {
    await usePhone();
    await renderApp();
    const scroll = centerOf(".timeline-scroll");
    const y = laneMiddleY();
    await drag({ x: scroll.x, y }, { x: scroll.x + 80, y }, 600);
    await expect.poll(() => isVisible(selection())).toBe(true);
    await hold({ x: scroll.x + 150, y }, 50);
    await expect.poll(selection).toBeNull();
    expect(visibleByRole("toolbar", "Selection actions")).toEqual([]);
  });

  // #1255: the transport's Loop button loops the selection and drops it.
  test("Loop loops a lane selection and clears it, else a bar from the playhead", { repeats: 9 }, async () => {
    await usePhone();
    await renderApp();
    const scroll = centerOf(".timeline-scroll");
    const y = laneMiddleY();
    await drag({ x: scroll.x, y }, { x: scroll.x + 120, y }, 600);
    await expect.poll(() => isVisible(selection())).toBe(true);
    const drawn = boxOf(".timeline-selection");

    const loop = await findByRole("button", "Loop");
    await tap(loop);
    await expect.poll(selection).toBeNull();
    expect(loop.getAttribute("aria-pressed")).toBe("true");
    const looped = boxOf(".loop-overlay");
    expect(Math.abs(looped.left - drawn.left)).toBeLessThan(1);
    expect(Math.abs(looped.width - drawn.width)).toBeLessThan(1);

    // Tapping it again drops the loop.
    await tap(loop);
    await expect.poll(() => document.querySelector(".loop-overlay")).toBeNull();

    // With nothing selected, it loops one bar from the playhead, snapped to
    // the grid (#1295): not from the start of the playhead's bar.
    const sc = query(".timeline-scroll");
    const log: string[] = [];
    const t0 = performance.now();
    const rec = (e: Event) => {
      const t = e.target as Element;
      log.push(`${Math.round(performance.now() - t0)} ${e.type} ${t.tagName}.${typeof t.className === "string" ? t.className.split(" ")[0] : ""}[${t.getAttribute?.("aria-label") ?? ""}] prevented=${e.defaultPrevented} sl=${sc.scrollLeft.toFixed(1)} ta=${getComputedStyle(sc).touchAction}`);
    };
    const types = ["pointerdown", "pointerup", "pointercancel", "touchstart", "touchend", "touchcancel", "click", "scrollend", "contextmenu"];
    for (const t of types) window.addEventListener(t, rec, true);
    sc.addEventListener("scrollend", rec);
    await drag({ x: scroll.x + 100, y }, { x: scroll.x - 70, y }, 0, 200);
    await settledPlayheadQ();
    log.push(`settled ${Math.round(performance.now() - t0)} q=${playheadQ()} sl=${sc.scrollLeft}`);
    const at = centerOf(loop);
    log.push(`loop at ${at.x},${at.y} connected=${loop.isConnected} hit=${document.elementFromPoint(at.x, at.y)?.closest("button")?.getAttribute("aria-label")}`);
    await tap(loop);
    await wait(800);
    log.push(`after tap pressed=${loop.getAttribute("aria-pressed")} overlay=${Boolean(document.querySelector(".loop-overlay"))}`);
    if (!document.querySelector(".loop-overlay")) {
      await tap(loop);
      await wait(800);
      log.push(`after retap pressed=${loop.getAttribute("aria-pressed")} overlay=${Boolean(document.querySelector(".loop-overlay"))}`);
    }
    for (const t of types) window.removeEventListener(t, rec, true);
    console.log(`DIAG\n${log.join("\n")}`);
    await expect.poll(() => isVisible(query(".loop-overlay"))).toBe(true);
    const bar = boxOf(".loop-overlay");
    const playhead = centerOf(".timeline-playhead-marker").x;
    const cell = gridCellPx(query('[data-timeline-lane-id="1"]'));
    expect(Math.abs(bar.left - playhead)).toBeLessThan(cell);
  });

  test("a double tap on empty lane space selects grid cells at least 64px wide", async () => {
    await usePhone();
    await renderApp();
    const scroll = centerOf(".timeline-scroll");
    const lane = query('[data-timeline-lane-id="1"]');
    const laneBox = lane.getBoundingClientRect();
    const y = laneMiddleY();
    const at = { x: scroll.x + 30, y };

    // A single tap still selects nothing.
    const before = await settledPlayheadQ();
    await hold(at, 30);
    await wait(400);
    expect(selection()).toBeNull();

    await hold(at, 30);
    await wait(80);
    await hold(at, 30);
    await expect.poll(() => isVisible(selection())).toBe(true);
    await findByRole("toolbar", "Selection actions");
    // The taps didn't scroll or scrub.
    expect(playheadQ()).toBe(before);

    // The fewest whole cells of the finest grid drawn that make 64px, so both
    // handles stay reachable (#1214), starting on a grid line.
    const cellPx = gridCellPx(lane);
    const box = boxOf(".timeline-selection");
    // Measured from the lane's padding edge, where the grid starts.
    const left = Number.parseFloat(query(".timeline-selection").style.left);
    expect(box.width).toBeCloseTo(Math.ceil(64 / cellPx - 1e-6) * cellPx, 0);
    expect(box.width).toBeGreaterThanOrEqual(63.5);
    expect(Math.abs(left / cellPx - Math.round(left / cellPx))).toBeLessThan(
      0.05,
    );
    expect(left).toBeLessThanOrEqual(at.x - laneBox.x + 1);
    expect(left + box.width).toBeGreaterThan(at.x - laneBox.x - 1);

    // The two handles' touch targets don't overlap, and the middle of the
    // selection belongs to neither.
    const start = (
      await findByRole("button", "Resize selection start")
    ).getBoundingClientRect();
    const end = (
      await findByRole("button", "Resize selection end")
    ).getBoundingClientRect();
    expect(start.x + start.width).toBeLessThanOrEqual(end.x + 0.5);
    const middle = document
      .elementFromPoint(box.x + box.width / 2, y)
      ?.closest(".timeline-selection__handle");
    expect(middle ? "handle" : "body").toBe("body");
  });

  test("a selected clip shows its trim handles, and dragging one trims it", async () => {
    await usePhone();
    await renderApp();
    await addClip();
    const start = query(".clip-card__handle--start");
    // Until the clip is selected its edges belong to the swipe.
    await userEvent.keyboard("{Escape}");
    await expect
      .poll(() => document.querySelectorAll(".clip-card--selected").length)
      .toBe(0);
    await expect.poll(() => getComputedStyle(start).opacity).toBe("0");
    expect(getComputedStyle(start).pointerEvents).toBe("none");
    await tap(query(".clip-card__body"));
    await expect
      .poll(() => getComputedStyle(query(".clip-card__handle--start")).opacity)
      .toBe("1");
    const toolbar = await findByRole("toolbar", "Clip actions");
    expect(toolbar.textContent).not.toContain("Trim");

    const before = boxOf(".clip-card");
    const handle = centerOf(".clip-card__handle--start");
    await drag(handle, { x: handle.x + 60, y: handle.y });
    await expect
      .poll(() => boxOf(".clip-card").x)
      .toBeGreaterThan(before.x + 30);
  });
});

describe(`${Timeline.name} on a tablet`, {
  timeout: PLAYWRIGHT_TEST_TIMEOUT,
}, () => {
  test("a double tap on empty lane space selects a grid cell", async () => {
    await useTablet();
    await renderApp();
    const lane = query('[data-timeline-lane-id="1"]');
    const laneBox = lane.getBoundingClientRect();
    const at = { x: laneBox.x + 150, y: laneBox.y + 20 };

    await hold(at, 30);
    await wait(80);
    await hold(at, 30);
    await expect
      .poll(() => lane.querySelectorAll(".timeline-selection").length)
      .toBe(1);
    const cellPx = gridCellPx(lane);
    // Whole cells at least 64px wide (#1214).
    expect(
      query(
        '[data-timeline-lane-id="1"] .timeline-selection',
      ).getBoundingClientRect().width,
    ).toBeCloseTo(Math.ceil(64 / cellPx - 1e-6) * cellPx, 0);
  });
});
