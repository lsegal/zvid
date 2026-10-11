import { describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { INITIAL_PROJECT_STATE } from "../../app/constants.ts";
import {
  EDITOR_TEST_TIMEOUT,
  renderEditor,
} from "../../component-test/editor.tsx";
import {
  center,
  down,
  type MouseButton,
  move,
  up,
} from "../../component-test/input.ts";
import { setViewport } from "../../component-test/viewport.ts";
import { addFillClip } from "../../fill-clip.ts";
import { Timeline } from "./Timeline";

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

describe(Timeline, { timeout: EDITOR_TEST_TIMEOUT }, () => {
  // The timeline sits flush against the window's left edge (just inside the
  // panel's 1px border), with square left corners, whether the FX row is
  // open or not. In the wide layout it also sits on the transport bar; the
  // narrow one stacks the preview under it instead.
  describe("left edge", () => {
    function expectFlush(onTransport: boolean) {
      const panel = query(".timeline-panel");
      const edges = panel.getBoundingClientRect();
      const style = getComputedStyle(panel);
      expect(edges.left).toBeLessThanOrEqual(1);
      if (onTransport) {
        expect(Math.abs(edges.bottom - box(".transport-bar").top)).toBeLessThan(
          1,
        );
      }
      expect(style.borderLeftWidth).toBe("0px");
      expect(style.borderTopLeftRadius).toBe("0px");
      expect(style.borderBottomLeftRadius).toBe("0px");
      expect(style.borderTopRightRadius).toBe("18px");
    }

    for (const { onTransport, ...viewport } of [
      { width: 1440, height: 900, onTransport: true },
      { width: 800, height: 1000, onTransport: false },
    ]) {
      test(`the timeline is flush with the window's left edge at ${viewport.width}px`, async () => {
        await setViewport(viewport);
        await renderEditor();
        expectFlush(onTransport);

        // The FX row shares the workspace column and lines up with it.
        expect(box(".fx-panel").left).toBe(0);

        const toggle = query(".fx-panel__toggle");
        const expanded = toggle.getAttribute("aria-expanded");
        await userEvent.click(toggle);
        await expect
          .poll(() => toggle.getAttribute("aria-expanded"))
          .not.toBe(expanded);
        expectFlush(onTransport);
        expect(box(".fx-panel").left).toBe(0);
      });
    }
  });

  // Middle-drag, or Space + left-drag, pans the timeline like a hand tool
  // from anywhere in it, without selecting, editing clips or toggling
  // playback.
  test("middle-drag and Space-drag pan the timeline without editing it", async () => {
    // A four-second clip at 120 BPM, eight quarters, at the start of Layer 1.
    const { clips, effects } = addFillClip(INITIAL_PROJECT_STATE, {
      id: "clip-1",
      laneId: "1",
      startQ: 0,
      durationQ: 8,
      bpm: 120,
      tint: "#2a2d38",
      accent: "#8d93a8",
      color: "#8d93a8",
      effectId: "effect-1",
    });
    const screen = await renderEditor({ project: { clips, effects } });
    const target = query('[data-timeline-lane-id="1"]');
    await expect
      .poll(() => target.querySelectorAll(".clip-card"))
      .toHaveLength(1);
    const clip = target.querySelector(".clip-card") as HTMLElement;

    const scroller = query(".timeline-scroll");
    const setScrollLeft = (left: number) =>
      new Promise((resolve) => {
        scroller.scrollLeft = left;
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
    const selections = () =>
      document.querySelectorAll(".timeline-selection").length;
    // The clip's offset from its lane's start, which only a clip move
    // changes.
    const clipOffset = () =>
      clip.getBoundingClientRect().x - target.getBoundingClientRect().x;
    const drag = async (
      from: { x: number; y: number },
      dx: number,
      button: MouseButton,
    ) => {
      await move(from.x, from.y);
      await down({ button });
      await move(from.x + dx / 2, from.y, { steps: 3 });
      await move(from.x + dx, from.y, { steps: 3 });
      // Rest before releasing so the pan does not fling.
      await new Promise((resolve) => setTimeout(resolve, 120));
      await up({ button });
    };

    expect(scroller.scrollWidth - scroller.clientWidth).toBeGreaterThan(400);
    const play = screen.getByRole("button", { name: "Play timeline" });
    await expect.element(play).toBeVisible();
    const offsetBefore = clipOffset();

    // Middle-drag on empty lane space, right of the clip.
    await setScrollLeft(400);
    const laneBox = target.getBoundingClientRect();
    const viewBox = scroller.getBoundingClientRect();
    const empty = { x: viewBox.x + viewBox.width - 80, y: laneBox.y + 20 };
    await drag(empty, 150, "middle");
    expect(scroller.scrollLeft).toBeCloseTo(250, -1);
    expect(selections()).toBe(0);
    expect(scroller.className).not.toMatch(/is-grab-panning/);

    // Middle-drag over the clip pans instead of moving it.
    await setScrollLeft(0);
    await drag(center(clip), -120, "middle");
    expect(scroller.scrollLeft).toBeCloseTo(120, -1);
    expect(clipOffset()).toBe(offsetBefore);
    expect(selections()).toBe(0);

    // Space + left-drag pans and releasing Space does not start playback.
    await setScrollLeft(0);
    await userEvent.keyboard("{Space>}");
    await expect
      .poll(() => scroller.className)
      .toMatch(/timeline-scroll--space-held/);
    await drag(empty, -200, "left");
    await userEvent.keyboard("{/Space}");
    expect(scroller.scrollLeft).toBeCloseTo(200, -1);
    expect(selections()).toBe(0);
    expect(scroller.className).not.toMatch(/timeline-scroll--space-held/);
    await expect.element(play).toBeVisible();

    // A plain Space tap still toggles playback.
    await userEvent.keyboard(" ");
    await expect
      .element(screen.getByRole("button", { name: "Pause playback" }))
      .toBeVisible();
    await userEvent.keyboard(" ");
    await expect.element(play).toBeVisible();

    // A plain left-drag on empty lane space still selects.
    await setScrollLeft(0);
    await drag({ x: empty.x - 200, y: empty.y }, 100, "left");
    await expect
      .poll(() => target.querySelectorAll(".timeline-selection").length)
      .toBe(1);
    expect(scroller.scrollLeft).toBe(0);
  });
});
