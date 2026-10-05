import { expect, type Page, test } from "@playwright/test";

// With a loop region, playback that reaches the out marker jumps back to the
// in marker and keeps playing; deleting the loop lets it run on (#1056).

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

function playButton(page: Page) {
  return page.locator('button[aria-label="Play timeline"]');
}

function pauseButton(page: Page) {
  return page.locator('button[aria-label="Pause playback"]');
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
  return {
    region,
    startQ: Number(await region.getAttribute("data-start-q")),
    endQ: Number(await region.getAttribute("data-end-q")),
  };
}

// The playhead marker's x every frame for `durationMs`.
function samplePlayheadX(page: Page, durationMs: number) {
  return page.evaluate(
    (duration) =>
      new Promise<number[]>((resolve) => {
        const samples: number[] = [];
        const startedAt = performance.now();
        const sample = () => {
          const marker = document.querySelector(".timeline-playhead-marker");
          if (marker) {
            samples.push(marker.getBoundingClientRect().x);
          }
          if (performance.now() - startedAt < duration) {
            requestAnimationFrame(sample);
          } else {
            resolve(samples);
          }
        };
        requestAnimationFrame(sample);
      }),
    durationMs,
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
});

test("playback loops between the in and out markers until stopped", async ({
  page,
}) => {
  const bounds = await insertTextClip(page);
  const { region, startQ, endQ } = await createLoop(
    page,
    bounds.x + 60,
    bounds.x + 120,
  );
  const regionBox = await region.boundingBox();
  const markerBox = await page
    .locator(".timeline-playhead-marker")
    .boundingBox();
  if (!regionBox || !markerBox) {
    throw new Error("Loop or playhead is not visible");
  }
  const quarterPx = regionBox.width / (endQ - startQ);
  // The playhead starts at 0, before the in marker.
  const zeroX = markerBox.x;
  const toQ = (x: number) => (x - zeroX) / quarterPx;

  await playButton(page).click();
  await expect(pauseButton(page)).toBeVisible();
  const samples = (await samplePlayheadX(page, 4500)).map(toQ);
  await pauseButton(page).click();

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

test("Play at the out marker starts from the in marker", async ({ page }) => {
  const bounds = await insertTextClip(page);
  const { region, startQ, endQ } = await createLoop(
    page,
    bounds.x + 60,
    bounds.x + 120,
  );
  const regionBox = await region.boundingBox();
  if (!regionBox) {
    throw new Error("Loop is not visible");
  }
  const quarterPx = regionBox.width / (endQ - startQ);
  // Park the playhead past the out marker with a click on the ruler above
  // the loop strip.
  const ruler = await page.locator(".ruler-row__content").boundingBox();
  if (!ruler) {
    throw new Error("Ruler is not visible");
  }
  const marker = page.locator(".timeline-playhead-marker");
  await page.mouse.click(regionBox.x + regionBox.width + 60, ruler.y + 4);
  await expect
    .poll(async () => (await marker.boundingBox())?.x ?? 0)
    .toBeGreaterThan(regionBox.x + regionBox.width);

  await playButton(page).click();
  await expect(pauseButton(page)).toBeVisible();
  const samples = await samplePlayheadX(page, 600);
  await pauseButton(page).click();

  const inX = regionBox.x;
  const outX = regionBox.x + regionBox.width;
  // Every sample is inside the loop: playback started from the in marker.
  for (const x of samples) {
    expect(x).toBeGreaterThanOrEqual(inX - quarterPx * 0.25);
    expect(x).toBeLessThanOrEqual(outX + quarterPx * 0.25);
  }
});

test("deleting the loop during playback lets playback run on", async ({
  page,
}) => {
  const bounds = await insertTextClip(page);
  const { region } = await createLoop(page, bounds.x + 60, bounds.x + 120);
  const regionBox = await region.boundingBox();
  if (!regionBox) {
    throw new Error("Loop is not visible");
  }
  const outX = regionBox.x + regionBox.width;

  await playButton(page).click();
  await expect(pauseButton(page)).toBeVisible();
  await region.dblclick();
  await expect(region).toHaveCount(0);

  const marker = page.locator(".timeline-playhead-marker");
  await expect
    .poll(async () => (await marker.boundingBox())?.x ?? 0, { timeout: 8000 })
    .toBeGreaterThan(outX + 20);
});
