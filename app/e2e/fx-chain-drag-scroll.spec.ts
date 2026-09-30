import { expect, type Page, test } from "@playwright/test";

// The layer effects strip pans sideways by hand-grab dragging its
// background, or middle-dragging anywhere in it, without getting in the way
// of knobs or device reordering.

test.use({ viewport: { width: 1280, height: 720 } });

async function openLongChain(page: Page) {
  // Without momentum, the scroll lands exactly where the pointer left it.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const layerHeader = page.locator('[data-layer-header-id="6"]');
  await expect(layerHeader).toBeVisible();

  // Add every effect so the chain overflows its panel.
  await layerHeader.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add FX", exact: true }).hover();
  const submenu = page.getByRole("menu", { name: "Add FX" });
  const count = await submenu.getByRole("menuitem").count();
  await submenu.getByRole("menuitem").first().click();
  for (let index = 1; index < count; index += 1) {
    await layerHeader.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Add FX", exact: true }).hover();
    await submenu.getByRole("menuitem").nth(index).click();
  }

  const chain = page.locator(".fx-chain");
  await expect
    .poll(() =>
      chain.evaluate((element) => element.scrollWidth - element.clientWidth),
    )
    .toBeGreaterThan(250);
  await chain.scrollIntoViewIfNeeded();
  return chain;
}

function scrollLeft(chain: ReturnType<Page["locator"]>) {
  return chain.evaluate((element) => element.scrollLeft);
}

async function drag(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  button: "left" | "middle" = "left",
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  await page.mouse.move(from.x + dx, from.y, { steps: 8 });
  await page.mouse.up({ button });
}

// A point in the chain's top padding, above the devices: background.
async function backgroundPoint(chain: ReturnType<Page["locator"]>) {
  const box = await chain.boundingBox();
  if (!box) {
    throw new Error("FX chain is not visible");
  }
  return { x: box.x + box.width / 2, y: box.y + 5 };
}

test("dragging the strip's background pans it with a hand cursor", async ({
  page,
}) => {
  const chain = await openLongChain(page);
  expect(
    await chain.evaluate((element) => getComputedStyle(element).cursor),
  ).toBe("grab");

  const start = await backgroundPoint(chain);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 100, start.y, { steps: 4 });
  await expect(chain).toHaveClass(/fx-chain--grab-scrolling/);
  expect(
    await chain.evaluate((element) => getComputedStyle(element).cursor),
  ).toBe("grabbing");
  await page.mouse.move(start.x - 200, start.y, { steps: 4 });
  await page.mouse.up();

  await expect(chain).not.toHaveClass(/fx-chain--grab-scrolling/);
  expect(await scrollLeft(chain)).toBe(200);

  // And back again.
  await drag(page, start, 150);
  expect(await scrollLeft(chain)).toBe(50);
});

test("a press below the drag threshold does not pan", async ({ page }) => {
  const chain = await openLongChain(page);
  await drag(page, await backgroundPoint(chain), -3);
  expect(await scrollLeft(chain)).toBe(0);
});

test("dragging a knob adjusts it rather than panning", async ({ page }) => {
  const chain = await openLongChain(page);
  const knob = chain.getByRole("slider").first();
  const box = await knob.boundingBox();
  if (!box) {
    throw new Error("No knob in the FX chain");
  }

  await drag(
    page,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    -150,
  );
  expect(await scrollLeft(chain)).toBe(0);
});

test("dragging a device title bar still reorders devices", async ({ page }) => {
  const chain = await openLongChain(page);
  const panels = chain.locator(".fx-device-panel");
  const names = () =>
    panels.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("aria-label")),
    );
  const before = await names();

  const title = panels.nth(1).locator(".fx-device-panel__title");
  // The target with its attached Animation section, when it has one.
  const target = panels
    .nth(2)
    .locator("xpath=ancestor-or-self::*[@data-fx-group][1]");

  // The target can run past the chain's right edge. Dropping out there
  // would auto-scroll the chain for as long as the drag lasts, so the slot
  // it lands in would depend on timing. Scroll the target clear of the
  // auto-scroll zone first.
  const chainBox = await chain.boundingBox();
  const unscrolledTargetBox = await target.boundingBox();
  if (!chainBox || !unscrolledTargetBox) {
    throw new Error("FX devices are not visible");
  }
  const autoScrollZone = 48;
  const overflow =
    unscrolledTargetBox.x +
    unscrolledTargetBox.width -
    (chainBox.x + chainBox.width - 2 * autoScrollZone);
  if (overflow > 0) {
    await chain.evaluate((element, left) => {
      element.scrollLeft = left;
    }, Math.ceil(overflow));
  }

  const titleBox = await title.boundingBox();
  const targetBox = await target.boundingBox();
  if (!titleBox || !targetBox) {
    throw new Error("FX devices are not visible");
  }
  expect(titleBox.x).toBeGreaterThan(chainBox.x + autoScrollZone);
  expect(targetBox.x + targetBox.width).toBeLessThan(
    chainBox.x + chainBox.width - autoScrollZone,
  );
  await drag(
    page,
    { x: titleBox.x + titleBox.width / 2, y: titleBox.y + titleBox.height / 2 },
    targetBox.x + targetBox.width - 4 - (titleBox.x + titleBox.width / 2),
  );

  await expect.poll(names).not.toEqual(before);
  const after = await names();
  expect(after[2]).toBe(before[1]);
  expect(after[1]).toBe(before[2]);
});

test("middle-dragging over a device pans the strip", async ({ page }) => {
  const chain = await openLongChain(page);
  const body = chain.locator(".fx-device-panel__body").first();
  const box = await body.boundingBox();
  if (!box) {
    throw new Error("No device body in the FX chain");
  }

  await drag(
    page,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    -120,
    "middle",
  );
  expect(await scrollLeft(chain)).toBe(120);
});
