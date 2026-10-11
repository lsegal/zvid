import { expect } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  center,
  click,
  down,
  isVisible,
  move,
  rightClick,
  up,
} from "./input.ts";

// Steps that several tests of the editor (editor.tsx) take the way the e2e
// specs take them, and readings of what it shows.

// Draws a selection on Layer 1 from `fromX` to `toX` (offsets into the
// lane) and inserts a text clip over it from the selection's menu. The clip
// stays selected, with its Text effect in the FX panel.
export async function insertTextClip(fromX = 20, toX = 400) {
  const lane = document.querySelector(
    '[data-timeline-lane-id="1"]',
  ) as HTMLElement;
  const bounds = lane.getBoundingClientRect();
  const y = bounds.y + bounds.height / 2;
  await move(bounds.x + fromX, y);
  await down();
  await move(bounds.x + (fromX + toX) / 2, y);
  await move(bounds.x + toX, y);
  await up();
  await click(bounds.x + (fromX + toX) / 2, bounds.y + 20, {
    button: "right",
  });
  const item = page
    .getByRole("menu", { name: "Selection actions" })
    .getByRole("menuitem", { name: "Insert Text Clip" });
  await expect.element(item).toBeVisible();
  await click(center(item.element()).x, center(item.element()).y);
  await expect
    .poll(() => lane.querySelectorAll(".clip-card--text").length)
    .toBe(1);
  return bounds;
}

// Inserts a fill clip on layer `laneId`, selected, and moves the playhead
// to its middle.
export async function insertFillAtStart(laneId: string) {
  const lane = () =>
    document.querySelector(
      `[data-timeline-lane-id="${laneId}"]`,
    ) as HTMLElement;
  const bounds = lane().getBoundingClientRect();
  const y = bounds.y + bounds.height / 2;
  await move(bounds.x + 40, y);
  await down();
  await move(bounds.x + 150, y);
  await move(bounds.x + 260, y);
  await up();
  await click(bounds.x + 150, y, { button: "right" });
  await page
    .getByRole("menu", { name: "Selection actions" })
    .getByRole("menuitem", { name: "Insert Fill Clip" })
    .click();
  const fill = () => lane().querySelector(".clip-card--fill") as HTMLElement;
  await expect.poll(() => fill()?.className).toMatch(/clip-card--selected/);
  const clip = fill().getBoundingClientRect();
  const ruler = (
    document.querySelector(".ruler-row") as HTMLElement
  ).getBoundingClientRect();
  await click(clip.x + clip.width / 2, ruler.y + ruler.height / 2);
  await expect.poll(() => fill().className).toMatch(/clip-card--selected/);
}

// Copies the first source clip to Layer 1 from its menu, and waits for the
// copy and the source clip to show frames.
export async function copySourceClipToLayer1() {
  await rightClick(document.querySelector(".source-span") as Element);
  await page.getByRole("menuitem", { name: "Copy to layer" }).hover();
  await page.getByRole("menuitem", { name: "Layer 1" }).click();
  const layer = '[data-layer-row-id="1"]';
  await expect
    .poll(() => document.querySelectorAll(`${layer} .clip-card`))
    .toHaveLength(1);
  await expect
    .poll(
      () => isVisible(document.querySelector(`${layer} .clip-card__tile`)),
      { timeout: 30_000 },
    )
    .toBe(true);
  await expect
    .poll(() =>
      isVisible(
        document.querySelector(
          ".track-row--source[data-source-track-id] .source-span__tile",
        ),
      ),
    )
    .toBe(true);
}

// Drags out a playback selection in the loop strip from `fromX` to `toX`
// (client x) and locks it into the loop with L.
export async function createLoop(fromX: number, toX: number) {
  const strip = (
    document.querySelector(".ruler-loop-strip") as HTMLElement
  ).getBoundingClientRect();
  const y = strip.y + strip.height / 2;
  await move(fromX, y);
  await down();
  await move(toX, y, { steps: 10 });
  await up();
  await userEvent.keyboard("L");
  await expect
    .poll(() => document.querySelector(".ruler-loop-region"))
    .not.toBeNull();
  const region = document.querySelector(".ruler-loop-region") as HTMLElement;
  return {
    region,
    box: region.getBoundingClientRect(),
    startQ: Number(region.dataset.startQ),
    endQ: Number(region.dataset.endQ),
  };
}

// Where the playhead is, in quarters: the ruler marker's `translateX` is the
// playhead's position less a pixel, and the second bar marker sits a bar
// (four quarters, in 4/4) in.
export function readPlayheadQ() {
  const marker = document.querySelector(
    ".timeline-playhead-marker",
  ) as HTMLElement;
  const bars = document.querySelectorAll<HTMLElement>(".ruler-marker");
  const left = Number(
    /translateX\((-?[\d.]+)px\)/.exec(marker.style.transform)?.[1],
  );
  const quarterPx = Number.parseFloat(bars[1].style.left) / 4;
  return (left + 1) / quarterPx;
}

// The playhead in quarters every frame for `durationMs`.
export function samplePlayheadQ(durationMs: number) {
  return new Promise<number[]>((resolve) => {
    const samples: number[] = [];
    const startedAt = performance.now();
    const sample = () => {
      samples.push(readPlayheadQ());
      if (performance.now() - startedAt < durationMs) {
        requestAnimationFrame(sample);
      } else {
        resolve(samples);
      }
    };
    requestAnimationFrame(sample);
  });
}
