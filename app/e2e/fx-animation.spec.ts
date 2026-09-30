import { expect, type Page, test } from "@playwright/test";

// The Animation modifier: a motion-icon toggle beside each device's power
// button that attaches a collapsible Animation section to the device's right
// edge. A newly added device has it on.

async function addLayerEffect(page: Page, name: RegExp) {
  const layerHeader = page.locator('[data-layer-header-id="6"]');
  await expect(layerHeader).toBeVisible();
  await layerHeader.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add FX", exact: true }).hover();
  await page
    .getByRole("menu", { name: "Add FX" })
    .getByRole("menuitem", { name })
    .click();
}

test("every device but Layout has an Animation toggle beside its power button", async ({
  page,
}) => {
  await page.goto("/");
  await addLayerEffect(page, /^Pixelate/);

  const layout = page.locator('section[aria-label="Layout"]');
  await expect(layout).toHaveCount(1);
  await expect(layout.locator(".fx-device-panel__animate")).toHaveCount(0);

  const pixelate = page.locator('section[aria-label="Pixelate"]');
  const toggle = pixelate.getByRole("button", {
    name: "Turn Animation Off for Pixelate",
  });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  // A decorative motion icon, like the power button's, rather than text.
  await expect(toggle.locator('svg[aria-hidden="true"]')).toHaveCount(1);
  await expect(toggle).toHaveText("");
  const power = await pixelate
    .getByRole("button", { name: "Bypass Pixelate" })
    .boundingBox();
  const box = await toggle.boundingBox();
  expect(power && box && box.x > power.x).toBe(true);
  expect(power && box && Math.round(box.width)).toBe(
    Math.round(power?.width ?? 0),
  );
});

test("the Animation section attaches, switches modes and folds", async ({
  page,
}) => {
  await page.goto("/");
  await addLayerEffect(page, /^Pixelate/);

  const pixelate = page.locator('section[aria-label="Pixelate"]');
  const section = page.locator('section[aria-label="Pixelate animation"]');

  // A newly added device has it on already.
  await expect(
    pixelate.getByRole("button", { name: "Turn Animation Off for Pixelate" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(section).toBeVisible();

  // It's attached to the device's right edge.
  const device = await pixelate.boundingBox();
  const attached = await section.boundingBox();
  expect(
    device && attached && Math.abs(attached.x - (device.x + device.width)) <= 2,
  ).toBe(true);

  // Clip mode, pre-filled with Pixelate's defaults.
  const mode = section.getByRole("group", { name: "Mode" });
  await expect(mode.getByRole("button")).toHaveText(["Clip", "Reactive"]);
  await expect(mode.getByRole("button", { name: "Clip" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(section.getByLabel("Motion In")).toHaveValue("Ease Out");
  await expect(section.getByLabel("Motion Out")).toHaveValue("Ease In");
  const timing = section.getByRole("group", { name: "Timing" });
  // Full stretches the animation over the whole clip.
  await expect(timing.getByRole("button")).toHaveText([
    "Slow",
    "Normal",
    "Fast",
    "Full",
  ]);
  await expect(timing.getByRole("button", { name: "Normal" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Reactive mode swaps in its own fields.
  await mode.getByRole("button", { name: "Reactive" }).click();
  await expect(section.getByLabel("Motion In")).toHaveCount(0);
  await expect(section.getByLabel("Motion")).toHaveValue("Bounce");
  await expect(section.locator(".knob__label")).toHaveText(["Reactivity"]);
  const parameters = section.getByRole("button", {
    name: "Parameters: 1 of 1",
  });
  await parameters.click();
  const items = page.getByRole("menuitemcheckbox");
  await expect(items).toHaveText(["Pixel Size"]);
  await expect(items.first()).toHaveAttribute("aria-checked", "true");
  await items.first().click();
  await expect(items.first()).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");
  await expect(
    section.getByRole("button", { name: "Parameters: 0 of 1" }),
  ).toBeVisible();

  // It folds into a strip of its own, and stays folded.
  await section
    .getByRole("button", { name: "Collapse Pixelate animation" })
    .click();
  const expand = section.getByRole("button", {
    name: "Expand Pixelate animation",
  });
  await expect(expand).toHaveText("Animation");
  expect((await section.boundingBox())?.width).toBeLessThan(40);
  const stored = await page.evaluate(() =>
    window.localStorage.getItem("zvid-fx-collapsed-devices"),
  );
  expect(stored).toMatch(/#animation/);
  await expand.click();
  await expect(section.getByRole("group", { name: "Mode" })).toBeVisible();

  // Turning it off detaches the section; turning it back on keeps the
  // settings.
  await pixelate
    .getByRole("button", { name: "Turn Animation Off for Pixelate" })
    .click();
  await expect(section).toHaveCount(0);
  await pixelate
    .getByRole("button", { name: "Turn Animation On for Pixelate" })
    .click();
  await expect(
    section
      .getByRole("group", { name: "Mode" })
      .getByRole("button", { name: "Reactive" }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("Order's Animation offers only Clip mode", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-layer-header-id="1"]').click();

  // A new session has a Global Order, animated.
  const section = page.locator('section[aria-label="Order animation"]');
  await expect(section).toBeVisible();
  await expect(section.getByRole("group", { name: "Mode" })).toHaveCount(0);
  await expect(section.getByRole("button", { name: "Reactive" })).toHaveCount(
    0,
  );
  await expect(section.getByLabel("Motion In")).toHaveValue("Ease Out");
  await expect(section.getByLabel("Motion Out")).toHaveValue("Ease In");
  await expect(section.locator(".knob__label")).toHaveCount(0);
});

// Order's Clip mode also picks how clips enter and exit its arrangement:
// Squish, for a new Order, or Push. No other device offers it.
test("Order's Animation section picks a Transition", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-layer-header-id="1"]').click();
  // A new session's Global Order is animated, at Order's defaults.
  await expect(
    page
      .locator('section[aria-label="Order"]')
      .getByRole("button", { name: "Turn Animation Off for Order" }),
  ).toHaveAttribute("aria-pressed", "true");

  const section = page.locator('section[aria-label="Order animation"]');
  const transition = section.getByRole("group", { name: "Transition" });
  await expect(transition.getByRole("button")).toHaveText(["Push", "Squish"]);
  await expect(
    transition.getByRole("button", { name: "Squish" }),
  ).toHaveAttribute("aria-pressed", "true");

  await transition.getByRole("button", { name: "Push" }).click();
  await expect(
    transition.getByRole("button", { name: "Push" }),
  ).toHaveAttribute("aria-pressed", "true");

  await addLayerEffect(page, /^Pixelate/);
  await expect(
    page
      .locator('section[aria-label="Pixelate animation"]')
      .getByRole("group", { name: "Transition" }),
  ).toHaveCount(0);
});
