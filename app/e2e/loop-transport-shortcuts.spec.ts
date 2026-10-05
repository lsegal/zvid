import { expect, type Page, test } from "@playwright/test";

// Ctrl/Cmd+Left and Right do what the outer skip buttons do, and
// Ctrl/Cmd+Space or Ctrl/Cmd-click on Play plays from the loop's in marker
// (#1107).
const BAR_QUARTERS = 4;

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

function button(page: Page, name: string) {
  return page.getByRole("button", { name, exact: true });
}

function playButton(page: Page) {
  return page.locator('button[aria-label="Play timeline"]');
}

function pauseButton(page: Page) {
  return page.locator('button[aria-label="Pause playback"]');
}

function textField(page: Page) {
  return page
    .locator('section[aria-label="Text"]')
    .getByRole("textbox", { name: "Text" });
}

// Where the playhead is, in quarters: the ruler marker's `translateX` is the
// playhead's position less a pixel, and the second bar marker sits a bar in.
function readQ(page: Page) {
  return page.evaluate((barQuarters) => {
    const marker = document.querySelector(
      ".timeline-playhead-marker",
    ) as HTMLElement;
    const bars = document.querySelectorAll<HTMLElement>(".ruler-marker");
    const left = Number(
      /translateX\((-?[\d.]+)px\)/.exec(marker.style.transform)?.[1],
    );
    const quarterPx = Number.parseFloat(bars[1].style.left) / barQuarters;
    return (left + 1) / quarterPx;
  }, BAR_QUARTERS);
}

// Runs `action` and returns the playhead once it has moved.
async function moveBy(page: Page, action: () => Promise<void>) {
  const beforeQ = await readQ(page);
  await action();
  await expect.poll(() => readQ(page)).not.toBe(beforeQ);
  return readQ(page);
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
  const box = await region.boundingBox();
  if (!box) {
    throw new Error("Loop is not visible");
  }
  return {
    box,
    startQ: Number(await region.getAttribute("data-start-q")),
    endQ: Number(await region.getAttribute("data-end-q")),
  };
}

// Clicks the ruler above the loop strip at `x`, parking the playhead there.
async function parkPlayhead(page: Page, x: number) {
  const ruler = await page.locator(".ruler-row__content").boundingBox();
  if (!ruler) {
    throw new Error("Ruler is not visible");
  }
  return moveBy(page, () => page.mouse.click(x, ruler.y + 4));
}

// The playhead in quarters every frame for `durationMs`.
function sampleQ(page: Page, durationMs: number) {
  return page.evaluate(
    ({ duration, barQuarters }) =>
      new Promise<number[]>((resolve) => {
        const samples: number[] = [];
        const startedAt = performance.now();
        const sample = () => {
          const marker = document.querySelector(
            ".timeline-playhead-marker",
          ) as HTMLElement;
          const bars = document.querySelectorAll<HTMLElement>(".ruler-marker");
          const left = Number(
            /translateX\((-?[\d.]+)px\)/.exec(marker.style.transform)?.[1],
          );
          samples.push(
            ((left + 1) * barQuarters) / Number.parseFloat(bars[1].style.left),
          );
          if (performance.now() - startedAt < duration) {
            requestAnimationFrame(sample);
          } else {
            resolve(samples);
          }
        };
        requestAnimationFrame(sample);
      }),
    { duration: durationMs, barQuarters: BAR_QUARTERS },
  );
}

// Every sample lies within the loop: playback started from its in marker.
function expectWithinLoop(
  samples: number[],
  loop: { startQ: number; endQ: number },
) {
  expect(samples.length).toBeGreaterThan(0);
  for (const q of samples) {
    expect(q).toBeGreaterThanOrEqual(loop.startQ - 0.1);
    expect(q).toBeLessThanOrEqual(loop.endQ + 0.1);
  }
}

test.use({ viewport: { width: 1600, height: 1200 } });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
});

test("Ctrl/Cmd+Left and Right jump like the outer skip buttons", async ({
  page,
}) => {
  const bounds = await insertTextClip(page);
  const loop = await createLoop(page, bounds.x + 60, bounds.x + 120);
  const insideX = loop.box.x + loop.box.width / 2;

  await parkPlayhead(page, insideX);
  expect(
    await moveBy(page, () => page.keyboard.press("ControlOrMeta+ArrowLeft")),
  ).toBeCloseTo(loop.startQ, 1);
  expect(
    await moveBy(page, () => page.keyboard.press("ControlOrMeta+ArrowLeft")),
  ).toBeCloseTo(0, 1);

  await parkPlayhead(page, insideX);
  expect(
    await moveBy(page, () => page.keyboard.press("ControlOrMeta+ArrowRight")),
  ).toBeCloseTo(loop.endQ, 1);
  const keyEndQ = await moveBy(page, () =>
    page.keyboard.press("ControlOrMeta+ArrowRight"),
  );
  expect(keyEndQ).toBeGreaterThan(loop.endQ);

  // The buttons take the same route.
  await parkPlayhead(page, insideX);
  await moveBy(page, () => button(page, "Jump to loop end").click());
  expect(
    await moveBy(page, () => button(page, "Jump to timeline end").click()),
  ).toBeCloseTo(keyEndQ, 3);

  // Plain arrows still step a frame.
  const beforeQ = await readQ(page);
  const steppedQ = await moveBy(page, () => page.keyboard.press("ArrowLeft"));
  expect(beforeQ - steppedQ).toBeLessThan(0.2);
});

test("Ctrl/Cmd+Left in a text field does not move the playhead", async ({
  page,
}) => {
  const bounds = await insertTextClip(page);
  await createLoop(page, bounds.x + 60, bounds.x + 120);
  await lane(page, "1").locator(".clip-card--text").click();
  const field = textField(page);
  await field.click();
  await field.press("End");
  const beforeQ = await readQ(page);

  await field.press("ControlOrMeta+ArrowLeft");
  await field.press("ControlOrMeta+ArrowRight");
  await expect(field).toBeFocused();
  expect(await readQ(page)).toBe(beforeQ);
});

test("Ctrl+Space plays from the loop start", async ({ page }) => {
  const bounds = await insertTextClip(page);
  const loop = await createLoop(page, bounds.x + 60, bounds.x + 120);
  // From 0, plain Play would start before the loop.
  await page.keyboard.press("Home");
  await expect.poll(() => readQ(page)).toBe(0);

  await page.keyboard.press("Control+Space");
  await expect(pauseButton(page)).toBeVisible();
  expectWithinLoop(await sampleQ(page, 500), loop);

  // While playing it restarts from the loop start rather than pausing.
  await page.keyboard.press("Control+Space");
  await expect(pauseButton(page)).toBeVisible();
  await pauseButton(page).click();
  await expect(playButton(page)).toBeVisible();
});

test("Ctrl/Cmd-click on Play plays from the loop start", async ({ page }) => {
  const bounds = await insertTextClip(page);
  const loop = await createLoop(page, bounds.x + 60, bounds.x + 120);
  await parkPlayhead(page, loop.box.x + loop.box.width + 80);
  expect(await readQ(page)).toBeGreaterThan(loop.endQ);
  await expect(playButton(page)).toHaveAttribute(
    "title",
    /click: play from loop start/,
  );

  await playButton(page).click({ modifiers: ["ControlOrMeta"] });
  await expect(pauseButton(page)).toBeVisible();
  expectWithinLoop(await sampleQ(page, 500), loop);

  await pauseButton(page).click({ modifiers: ["ControlOrMeta"] });
  await expect(pauseButton(page)).toBeVisible();
  expectWithinLoop(await sampleQ(page, 300), loop);
  await pauseButton(page).click();
  await expect(playButton(page)).toBeVisible();
});
