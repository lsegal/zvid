import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import {
  createLoop,
  insertTextClip,
  renderTimelineEditor,
  TIMELINE_EDITOR_TIMEOUT,
} from "../component-test/timeline-editor.tsx";
import { center, click, dblclick } from "../component-test/timeline-mouse.ts";
import { usePlayback } from "./usePlayback.ts";

// With a loop region, playback that reaches the out marker jumps back to the
// in marker and keeps playing; deleting the loop lets it run on (#1056).

const playButton = () => page.getByRole("button", { name: "Play timeline" });
const pauseButton = () =>
  page.getByRole("button", { name: "Pause playback" });

function markerX() {
  return (
    document.querySelector(".timeline-playhead-marker") as HTMLElement
  ).getBoundingClientRect().x;
}

// The playhead marker's x every frame for `durationMs`.
function samplePlayheadX(durationMs: number) {
  return new Promise<number[]>((resolve) => {
    const samples: number[] = [];
    const startedAt = performance.now();
    const sample = () => {
      samples.push(markerX());
      if (performance.now() - startedAt < durationMs) {
        requestAnimationFrame(sample);
      } else {
        resolve(samples);
      }
    };
    requestAnimationFrame(sample);
  });
}

async function pressButton(button: ReturnType<typeof playButton>) {
  await expect.element(button).toBeVisible();
  const { x, y } = center(button.element());
  await click(x, y);
}

describe(usePlayback, { timeout: TIMELINE_EDITOR_TIMEOUT }, () => {
  test("playback loops between the in and out markers until stopped", async () => {
    await renderTimelineEditor();
    // A text clip across the start of Layer 1, so there is something to
    // play.
    const bounds = await insertTextClip();
    const { box, startQ, endQ } = await createLoop(
      bounds.x + 60,
      bounds.x + 120,
    );
    const quarterPx = box.width / (endQ - startQ);
    // The playhead starts at 0, before the in marker.
    const zeroX = markerX();
    const toQ = (x: number) => (x - zeroX) / quarterPx;

    await pressButton(playButton());
    await expect.element(pauseButton()).toBeVisible();
    const samples = (await samplePlayheadX(4500)).map(toQ);
    await pressButton(pauseButton());

    // It never runs past the out marker, and jumps back to the in marker on
    // reaching it, more than once.
    const tolerance = 0.25;
    expect(Math.max(...samples)).toBeLessThanOrEqual(endQ + tolerance);
    const wraps = samples.filter(
      (q, index) => index > 0 && q < samples[index - 1] - (endQ - startQ) / 2,
    );
    expect(wraps.length).toBeGreaterThanOrEqual(2);
    for (const q of wraps) {
      expect(q).toBeGreaterThanOrEqual(startQ - tolerance);
      expect(q).toBeLessThan(startQ + (endQ - startQ) / 2);
    }
  });

  test("Play at the out marker starts from the in marker", async () => {
    await renderTimelineEditor();
    const bounds = await insertTextClip();
    const { box, startQ, endQ } = await createLoop(
      bounds.x + 60,
      bounds.x + 120,
    );
    const quarterPx = box.width / (endQ - startQ);
    // Park the playhead past the out marker with a click on the ruler above
    // the loop strip.
    const ruler = (
      document.querySelector(".ruler-row__content") as HTMLElement
    ).getBoundingClientRect();
    await click(box.x + box.width + 60, ruler.y + 4);
    await expect.poll(markerX).toBeGreaterThan(box.x + box.width);

    await pressButton(playButton());
    await expect.element(pauseButton()).toBeVisible();
    const samples = await samplePlayheadX(600);
    await pressButton(pauseButton());

    const inX = box.x;
    const outX = box.x + box.width;
    // Every sample is inside the loop: playback started from the in marker.
    for (const x of samples) {
      expect(x).toBeGreaterThanOrEqual(inX - quarterPx * 0.25);
      expect(x).toBeLessThanOrEqual(outX + quarterPx * 0.25);
    }
  });

  test("deleting the loop during playback lets playback run on", async () => {
    await renderTimelineEditor();
    const bounds = await insertTextClip();
    const { region, box } = await createLoop(bounds.x + 60, bounds.x + 120);
    const outX = box.x + box.width;

    await pressButton(playButton());
    await expect.element(pauseButton()).toBeVisible();
    const body = center(region);
    await dblclick(body.x, body.y);
    await expect
      .poll(() => document.querySelectorAll(".ruler-loop-region").length)
      .toBe(0);

    await expect
      .poll(markerX, { timeout: 8000 })
      .toBeGreaterThan(outX + 20);
  });
});
