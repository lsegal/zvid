import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { RenderResult } from "vitest-browser-react";
import {
  EDITOR_TEST_TIMEOUT,
  renderEditor,
} from "../../component-test/editor.tsx";
import {
  center,
  click,
  dblclick,
  down,
  move,
  up,
} from "../../component-test/input.ts";
import { LoopOverlay } from "./LoopOverlay";

// The loop region (#1099, #1103): its brace in the ruler is gray, and its in
// and out markers run down the timeline as yellow dotted lines, 2px dots
// with 4px gaps, with a faint yellow tint between them, behind the clips.

const LOOP_YELLOW = "rgb(242, 209, 92)";

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

// The computed color of a CSS color expression.
function cssColor(value: string) {
  const probe = document.createElement("div");
  probe.style.background = value;
  document.body.append(probe);
  const color = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return color;
}

// Whether each CSS pixel down a 1px-wide line is mostly yellow, sampled
// from a screenshot of the page.
async function yellowPixels(line: { x: number; y: number; height: number }) {
  const data = await page.screenshot({ save: false });
  const image = new Image();
  image.src = `data:image/png;base64,${data}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("No 2D context");
  }
  context.drawImage(image, 0, 0);
  const scale = image.width / document.documentElement.clientWidth;
  const column = Math.floor((line.x + 0.5) * scale);
  return Array.from({ length: line.height }, (_, y) => {
    const [r, g, b] = context.getImageData(
      column,
      Math.floor((line.y + y + 0.5) * scale),
      1,
      1,
    ).data;
    return r - b > 80 && g - b > 60;
  });
}

// Inserts a fill clip on Layer 1 and leaves it unselected, so it stacks at
// the clips' own depth rather than the selected clip's.
async function insertFillClip(screen: RenderResult) {
  const bounds = box('[data-timeline-lane-id="1"]');
  const y = bounds.y + bounds.height / 2;
  await move(bounds.x + 200, y);
  await down();
  await move(bounds.x + 300, y);
  await move(bounds.x + 400, y);
  await up();
  await click(bounds.x + 300, y, { button: "right" });
  const item = screen
    .getByRole("menu", { name: "Selection actions" })
    .getByRole("menuitem", { name: "Insert Fill Clip" });
  await expect.element(item).toBeVisible();
  const { x, y: itemY } = center(item.element());
  await click(x, itemY);
  await expect
    .poll(() => document.querySelector(".clip-card--fill"))
    .not.toBeNull();
  await userEvent.keyboard("{Escape}");
  const fill = query('[data-timeline-lane-id="1"] .clip-card--fill');
  await expect.poll(() => fill.className).not.toMatch(/clip-card--selected/);
  return fill;
}

// The topmost element at a point, counting the loop overlay even though it
// lets pointer events through.
function topmostAt(x: number, y: number) {
  const overlays = [...document.querySelectorAll<HTMLElement>(".loop-overlay")];
  for (const overlay of overlays) {
    overlay.style.pointerEvents = "auto";
    for (const line of overlay.children) {
      (line as HTMLElement).style.pointerEvents = "auto";
    }
  }
  const element = document.elementFromPoint(x, y);
  for (const overlay of overlays) {
    overlay.style.pointerEvents = "";
    for (const line of overlay.children) {
      (line as HTMLElement).style.pointerEvents = "";
    }
  }
  if (element?.closest(".clip-card")) {
    return "clip";
  }
  return element?.closest(".loop-overlay") ? "loop" : "other";
}

describe(LoopOverlay, { timeout: EDITOR_TEST_TIMEOUT }, () => {
  test("the loop is gray in the ruler and runs down the timeline behind clips", async () => {
    const screen = await renderEditor({ reducedMotion: true });
    const fill = await insertFillClip(screen);
    expect(document.querySelectorAll(".loop-overlay")).toHaveLength(0);

    // Lock a loop from before the clip to its middle.
    const clip = fill.getBoundingClientRect();
    const strip = box(".ruler-loop-strip");
    const stripY = strip.y + strip.height / 2;
    await move(clip.x - 80, stripY);
    await down();
    await move(clip.x + clip.width / 2, stripY, { steps: 10 });
    await up();
    await userEvent.keyboard("l");
    await expect
      .poll(() => document.querySelector(".ruler-loop-region"))
      .not.toBeNull();

    // The ruler brace is gray: its bar, flags and handles.
    const background = (selector: string) =>
      getComputedStyle(query(selector)).backgroundColor;
    const ink = cssColor("var(--ink)");
    expect(ink).not.toBe(LOOP_YELLOW);
    for (const part of [
      "marker--in",
      "marker--out",
      "handle--start",
      "handle--end",
    ]) {
      expect(background(`.ruler-loop-region__${part}`)).toBe(ink);
    }
    expect(background(".ruler-loop-region")).toBe(
      cssColor("color-mix(in srgb, var(--ink) 55%, transparent)"),
    );

    // Dotted yellow lines, 2px dots every 6px, at the loop's ends, from the
    // ruler's bottom through the layer rows, with a faint tint between them.
    const region = box(".ruler-loop-region");
    const start = box(".timeline-loop .loop-overlay__line--start");
    const end = box(".timeline-loop .loop-overlay__line--end");
    const tint = box(".timeline-loop");
    expect(Math.abs(start.x - region.x)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(end.x + end.width - (region.x + region.width)),
    ).toBeLessThan(1);
    expect(Math.abs(tint.x - start.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(tint.x + tint.width - (end.x + end.width))).toBeLessThan(1);
    const ruler = box(".ruler-row");
    const layer = box('[data-timeline-lane-id="1"]');
    expect(Math.abs(start.y - (ruler.y + ruler.height))).toBeLessThanOrEqual(1);
    expect(start.y + start.height).toBeGreaterThanOrEqual(
      layer.y + layer.height,
    );
    for (const line of ["start", "end"]) {
      const computed = getComputedStyle(
        query(`.timeline-loop .loop-overlay__line--${line}`),
      );
      expect(computed.borderLeftStyle).toBe("none");
      expect(computed.backgroundImage).toBe(
        `repeating-linear-gradient(${LOOP_YELLOW} 0px, ${LOOP_YELLOW} 2px, rgba(0, 0, 0, 0) 2px, rgba(0, 0, 0, 0) 6px)`,
      );
    }
    // In the empty stretch of Layer 1 before the clip, the dots start every
    // 6px from the line's top and each is 2px long.
    const sampleTop = Math.ceil(layer.y) + 2;
    const pixels = await yellowPixels({
      x: Math.floor(start.x),
      y: sampleTop,
      height: 30,
    });
    const offset = sampleTop - start.y;
    pixels.forEach((yellow, y) => {
      const phase = (((y + offset) % 6) + 6) % 6;
      if (phase < 0.75 || phase > 5.75 || Math.abs(phase - 2) < 0.75) {
        return;
      }
      expect(yellow, `pixel ${y} (phase ${phase})`).toBe(phase < 2);
    });
    expect(background(".timeline-loop")).not.toBe("rgba(0, 0, 0, 0)");

    // The Audio row's footer carries the loop too, lined up with the rows.
    const audioStart = box(".timeline-footer__loop .loop-overlay__line--start");
    expect(Math.abs(audioStart.x - start.x)).toBeLessThanOrEqual(1);

    // The clip paints over the end line and tint, which paint over the lane.
    const clipY = clip.y + clip.height / 2;
    expect(topmostAt(end.x + 0.5, clipY)).toBe("clip");
    expect(topmostAt((clip.x + end.x) / 2, clipY)).toBe("clip");
    expect(topmostAt(start.x + 0.5, clipY)).toBe("loop");
    expect(topmostAt((start.x + clip.x) / 2, clipY)).toBe("loop");
    // And none of it takes the pointer.
    expect(
      document.elementFromPoint(start.x + 0.5, clipY)?.closest(".loop-overlay"),
    ).toBeNull();

    // Deleting the loop removes its lines and tint.
    const body = center(query(".ruler-loop-region__body"));
    await dblclick(body.x, body.y);
    await expect
      .poll(() => document.querySelectorAll(".ruler-loop-region").length)
      .toBe(0);
    expect(document.querySelectorAll(".loop-overlay")).toHaveLength(0);
  });
});
