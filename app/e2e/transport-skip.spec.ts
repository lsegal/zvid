import { expect, type Page, test } from "@playwright/test";

// The outer skip buttons jump to the loop's markers and the timeline's ends,
// labeled with where they go, and playback carries on from there (#1091).

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

function backButton(page: Page) {
  return page.locator(".transport-button--skip-start");
}

function forwardButton(page: Page) {
  return page.locator(".transport-button--skip-end");
}

// A text clip across the start of Layer 1, so there is something to play.
async function insertTextClip(page: Page) {
  const bounds = await lane(page, "1").boundingBox();
  if (!bounds) {
    throw new Error("Lane is not visible");
  }
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + 20, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 200, y);
  await page.mouse.move(bounds.x + 400, y);
  await page.mouse.up();
  await page.mouse.click(bounds.x + 200, bounds.y + 20, { button: "right" });
  await page
    .getByRole("menu", { name: "Selection actions" })
    .getByRole("menuitem", { name: "Insert Text Clip" })
    .click();
  await expect(lane(page, "1").locator(".clip-card--text")).toHaveCount(1);
  return bounds;
}

// Drags out a playback selection in the loop strip and locks it with L.
async function createLoop(page: Page, fromX: number, toX: number) {
  const strip = await page.locator(".ruler-loop-strip").boundingBox();
  if (!strip) {
    throw new Error("Loop strip is not visible");
  }
  const y = strip.y + strip.height / 2;
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  await page.mouse.move(toX, y, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.press("L");
  const region = page.locator(".ruler-loop-region");
  await expect(region).toBeVisible();
  return region;
}

// The playhead and the loop's markers, in page pixels, read together so a
// timeline scroll moves them all.
function positions(page: Page) {
  return page.evaluate(() => {
    const x = (selector: string) =>
      document.querySelector(selector)?.getBoundingClientRect().x ?? NaN;
    const region = document.querySelector(".ruler-loop-region");
    const regionBox = region?.getBoundingClientRect();
    return {
      playheadX: x(".timeline-playhead-marker"),
      inX: regionBox?.x ?? NaN,
      outX: regionBox ? regionBox.x + regionBox.width : NaN,
      laneX: x('[data-timeline-lane-id="1"]'),
    };
  });
}

// Where the playhead is: at the loop's in or out marker, at the timeline
// start, or past the loop.
async function playheadAt(page: Page) {
  const { playheadX, inX, outX, laneX } = await positions(page);
  const near = (a: number, b: number) => Math.abs(a - b) <= 2;
  if (near(playheadX, inX)) return "loop start";
  if (near(playheadX, outX)) return "loop end";
  if (near(playheadX, laneX)) return "timeline start";
  return playheadX > outX ? "after loop" : "elsewhere";
}

async function skip(
  button: ReturnType<typeof backButton>,
  label: string,
  page: Page,
  expected: string,
) {
  await expect(button).toHaveAttribute("aria-label", label);
  await expect(button).toHaveAttribute("title", label);
  await button.click();
  await expect.poll(() => playheadAt(page)).toBe(expected);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
});

test("the skip buttons jump between the loop's markers and the timeline's ends", async ({
  page,
}) => {
  const bounds = await insertTextClip(page);
  const region = await createLoop(page, bounds.x + 60, bounds.x + 120);
  await expect.poll(() => playheadAt(page)).toBe("timeline start");

  // Forward: before the loop, to its start, then its end, then the end.
  const forward = forwardButton(page);
  await skip(forward, "Jump to loop start", page, "loop start");
  await skip(forward, "Jump to loop end", page, "loop end");
  await skip(forward, "Jump to timeline end", page, "after loop");
  await expect(forward).toHaveAttribute("aria-label", "Jump to timeline end");

  // Back: after the loop, to its end, then from inside to its start, then
  // the timeline start.
  const back = backButton(page);
  await skip(back, "Jump to loop end", page, "loop end");
  await skip(back, "Jump to loop start", page, "loop start");
  await skip(back, "Jump to timeline start", page, "timeline start");
  await expect(back).toHaveAttribute("aria-label", "Jump to timeline start");

  // Without a loop, they go to the timeline's ends.
  await region.dblclick();
  await expect(region).toHaveCount(0);
  await expect(forward).toHaveAttribute("aria-label", "Jump to timeline end");
  await forward.click();
  await expect
    .poll(async () => {
      const { playheadX, laneX } = await positions(page);
      return playheadX - laneX;
    })
    .toBeGreaterThan(200);
  await skip(back, "Jump to timeline start", page, "timeline start");
});

test("playback carries on from where the skip buttons jump", async ({
  page,
}) => {
  const bounds = await insertTextClip(page);
  await createLoop(page, bounds.x + 60, bounds.x + 120);
  await page.getByRole("button", { name: "Play timeline" }).click();
  const pause = page.getByRole("button", { name: "Pause playback" });
  await expect(pause).toBeVisible();

  // Once the playhead is inside the loop, Forward jumps to its out marker
  // and playback runs on past it.
  const forward = forwardButton(page);
  await expect(forward).toHaveAttribute("aria-label", "Jump to loop end");
  await forward.click();
  await expect(pause).toBeVisible();
  await expect
    .poll(async () => {
      const { playheadX, outX } = await positions(page);
      return playheadX - outX;
    })
    .toBeGreaterThan(10);
  await expect(pause).toBeVisible();
  await pause.click();
});
