import { expect, type Page, test } from "@playwright/test";

// The transport's half-bar buttons land on the snap grid when snapping is
// on, and move exactly half a bar when it's off (#1092). At 100% zoom the
// grid is in eighth notes, and a 4/4 bar is four quarters.
const BAR_QUARTERS = 4;
const GRID_QUARTERS = 0.5;

test.use({ viewport: { width: 1600, height: 1200 } });

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

function button(page: Page, name: string) {
  return page.getByRole("button", { name, exact: true });
}

// Opens a blank session with the playhead at 0.
async function open(page: Page) {
  await page.goto("/");
  await expect(page.locator('[data-timeline-lane-id="1"]')).toBeVisible();
  await expect.poll(() => readQ(page)).toBe(0);
}

function expectOnGrid(valueQ: number) {
  const steps = valueQ / GRID_QUARTERS;
  expect(Math.abs(steps - Math.round(steps))).toBeLessThan(0.05);
}

test("with snap on, the half-bar buttons land an off-grid playhead on the grid", async ({
  page,
}) => {
  await open(page);
  await expect(button(page, "Snap On")).toHaveAttribute("aria-pressed", "true");

  // Five frames in puts the playhead between grid lines.
  const offGridQ = await moveBy(page, () =>
    page.keyboard.press("Shift+ArrowRight"),
  );
  expect(offGridQ).toBeGreaterThan(0.05);
  expect(offGridQ % GRID_QUARTERS).toBeGreaterThan(0.05);

  const forwardQ = await moveBy(page, () =>
    button(page, "Jump forward half a bar").click(),
  );
  expectOnGrid(forwardQ);
  expect(
    Math.abs(forwardQ - (offGridQ + BAR_QUARTERS / 2)),
  ).toBeLessThanOrEqual(GRID_QUARTERS / 2 + 0.05);

  const nextOffGridQ = await moveBy(page, () =>
    page.keyboard.press("Shift+ArrowRight"),
  );
  const backQ = await moveBy(page, () =>
    button(page, "Jump back half a bar").click(),
  );
  expectOnGrid(backQ);
  expect(
    Math.abs(backQ - (nextOffGridQ - BAR_QUARTERS / 2)),
  ).toBeLessThanOrEqual(GRID_QUARTERS / 2 + 0.05);

  // On the grid, a jump is exactly half a bar.
  expect(
    await moveBy(page, () => button(page, "Jump forward half a bar").click()),
  ).toBeCloseTo(backQ + BAR_QUARTERS / 2, 1);
});

test("with snap off, the half-bar buttons move exactly half a bar", async ({
  page,
}) => {
  await open(page);
  await button(page, "Snap On").click();
  await expect(button(page, "Snap Off")).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  const offGridQ = await moveBy(page, () =>
    page.keyboard.press("Shift+ArrowRight"),
  );
  expect(offGridQ % GRID_QUARTERS).toBeGreaterThan(0.05);

  const forwardQ = await moveBy(page, () =>
    button(page, "Jump forward half a bar").click(),
  );
  expect(forwardQ).toBeCloseTo(offGridQ + BAR_QUARTERS / 2, 1);

  expect(
    await moveBy(page, () => button(page, "Jump back half a bar").click()),
  ).toBeCloseTo(offGridQ, 1);
});
