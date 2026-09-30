import { expect, test } from "@playwright/test";

// A tall device chain must not squeeze the arrangement on a short window:
// the FX panel is capped and its device chain scrolls instead.

test.use({ viewport: { width: 1280, height: 720 } });

test("a tall FX device keeps the arrangement usable", async ({ page }) => {
  await page.goto("/");
  const layerHeader = page.locator('[data-layer-header-id="6"]');
  await expect(layerHeader).toBeVisible();

  // Add every effect so the chain holds its tallest device.
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

  const editor = await page.locator(".editor-panel").boundingBox();
  const fxPanel = await page.locator(".fx-panel").boundingBox();
  expect(editor?.height).toBeGreaterThanOrEqual(fxPanel?.height ?? 0);

  // The layer headers stay clickable above the FX panel.
  await layerHeader.click({ button: "right" });
  await expect(
    page.getByRole("menu", { name: "Layer header actions" }),
  ).toBeVisible();
});

// Knobs fill at most two rows: Transform reads X Y Width Height, then
// Origin X Origin Y Rotation.
test("Transform lays its knobs out in two rows", async ({ page }) => {
  await page.goto("/");
  const layerHeader = page.locator('[data-layer-header-id="6"]');
  await layerHeader.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add FX", exact: true }).hover();
  await page
    .getByRole("menu", { name: "Add FX" })
    .getByRole("menuitem", { name: /^Transform/ })
    .click();

  const knobs = page.locator(
    'section[aria-label="Transform"] .fx-device-panel__body > *',
  );
  await expect(knobs).toHaveCount(7);
  const rows = new Map<number, string[]>();
  for (const knob of await knobs.all()) {
    const top = Math.round((await knob.boundingBox())?.y ?? 0);
    const label = (await knob.locator(".knob__label").textContent()) ?? "";
    rows.set(top, [...(rows.get(top) ?? []), label]);
  }
  expect(
    [...rows.entries()].sort(([a], [b]) => a - b).map(([, row]) => row),
  ).toEqual([
    ["X", "Y", "Width", "Height"],
    ["Origin X", "Origin Y", "Rotation"],
  ]);
});

// Move puts its Motion curve on its own row, then a Start row and an End row
// of Transform's knobs, each led by its label.
test("Move lays out Motion, then labeled Start and End rows", async ({
  page,
}) => {
  await page.goto("/");
  const layerHeader = page.locator('[data-layer-header-id="6"]');
  await layerHeader.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add FX", exact: true }).hover();
  await page
    .getByRole("menu", { name: "Add FX" })
    .getByRole("menuitem", { name: /^Move/ })
    .click();

  const move = page.locator('section[aria-label="Move"]');
  const motion = move.getByRole("group", { name: "Motion" });
  await expect(motion.getByRole("button")).toHaveText([
    "Linear",
    "Ease In",
    "Ease Out",
    "Ease In Out",
  ]);
  await expect(
    motion.getByRole("button", { name: "Ease In Out" }),
  ).toHaveAttribute("aria-pressed", "true");

  // Each row's label sits left of its knobs, which share one line below the
  // previous row's.
  let previousTop = (await motion.boundingBox())?.y ?? 0;
  for (const name of ["Start", "End"]) {
    const row = move.getByRole("group", { name });
    const labels = row.locator(".knob__label");
    await expect(labels).toHaveText([
      "X",
      "Y",
      "Width",
      "Height",
      "Origin X",
      "Origin Y",
      "Rotation",
    ]);
    const tops = new Set<number>();
    for (const label of await labels.all()) {
      tops.add(Math.round((await label.boundingBox())?.y ?? 0));
    }
    expect(tops.size).toBe(1);
    const [top] = tops;
    expect(top).toBeGreaterThan(previousTop);
    previousTop = top;

    const legend = await row.locator("legend").boundingBox();
    const first = await labels.first().boundingBox();
    expect(legend && first && legend.x + legend.width <= first.x).toBe(true);
  }
});

// Every new session arranges its layers with a Vertical Order on the Global
// stack. Removing it lets the layers overlap, which the Global section
// points out.
test("a new session has a Global Order, and removing it shows a hint", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('[data-layer-header-id="1"]').click();

  const order = page.locator('section[aria-label="Order"]');
  await expect(order).toHaveCount(1);
  await expect(order).toContainText("Vertical");
  const hint = page.getByText(
    "No Order: layers overlap (Layer 1 on top). Add Order to arrange them.",
  );
  await expect(hint).toHaveCount(0);

  await order.getByRole("button", { name: "Remove Order" }).click();
  await expect(order).toHaveCount(0);
  await expect(hint).toBeVisible();

  await page.keyboard.press("ControlOrMeta+z");
  await expect(order).toHaveCount(1);
  await expect(hint).toHaveCount(0);
});

// The chain reads GLOBAL | LAYER, and GLOBAL | LAYER | CLIP once a clip is
// selected; the title names the selection.
test("the FX panel shows Global, then the layer, then the selected clip", async ({
  page,
}) => {
  await page.goto("/");
  const title = page.locator(".fx-panel__toggle");
  const sections = page.locator(".fx-chain [data-fx-divider]");

  await page.locator('[data-layer-header-id="5"]').click();
  await expect(title).toHaveText("Layer 2 Effects");
  await expect(sections).toHaveText(["Global", "Layer"]);
  await expect(
    page.getByRole("button", { name: "Add device to Global" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add device to this clip" }),
  ).toHaveCount(0);

  await page.locator('[data-layer-header-id="5"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Insert text at playhead" }).click();
  await expect(
    page.locator('[data-timeline-lane-id="5"] .clip-card--selected'),
  ).toHaveCount(1);
  await expect(title).toHaveText("Clip Text Effects (Layer 2)");
  await expect(sections).toHaveText(["Global", "Layer", "Clip"]);

  // Global's Order sits left of the layer's devices, which sit left of the
  // clip's add slot.
  const order = await page.locator('section[aria-label="Order"]').boundingBox();
  const layout = await page
    .locator('section[aria-label="Layout"]')
    .boundingBox();
  const addToClip = await page
    .getByRole("button", { name: "Add device to this clip" })
    .boundingBox();
  expect(order?.x ?? 0).toBeLessThan(layout?.x ?? 0);
  expect(layout?.x ?? 0).toBeLessThan(addToClip?.x ?? 0);

  // Adding from the clip slot puts the device on the clip's stack.
  await page.getByRole("button", { name: "Add device to this clip" }).click();
  await page.getByRole("menuitem", { name: /^Transform/ }).click();
  const clipTransform = page.locator(
    `.fx-chain :is(section[data-fx-group="clip"], [data-fx-group="clip"] > section)[aria-label="Transform"]`,
  );
  await expect(clipTransform).toHaveCount(1);
});

// The Order's Layers button opens a checkmark menu of every layer. Toggling
// a row leaves the menu open and updates the button, and each toggle is one
// undo step.
test("the Order's Layers menu toggles layers in place", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-layer-header-id="1"]').click();

  const order = page.locator('section[aria-label="Order"]');
  // The open menu hides the rest of the page from the accessibility tree.
  const button = order.locator(".fx-layers__trigger");
  await expect(button).toHaveText("Layers: All");

  await button.click();
  const menu = page.getByRole("menu", { name: /^Layers: / });
  await expect(menu).toBeVisible();
  const rows = menu.getByRole("menuitemcheckbox");
  const count = await rows.count();
  expect(count).toBeGreaterThan(1);
  for (let index = 0; index < count; index++) {
    await expect(rows.nth(index)).toHaveAttribute("aria-checked", "true");
  }

  await rows.first().click();
  await expect(menu).toBeVisible();
  await expect(rows.first()).toHaveAttribute("aria-checked", "false");
  await expect(button).toHaveText(`Layers: ${count - 1} of ${count}`);

  // Space toggles the highlighted row from the keyboard.
  await rows.nth(1).focus();
  await page.keyboard.press("Space");
  await expect(menu).toBeVisible();
  await expect(button).toHaveText(`Layers: ${count - 2} of ${count}`);

  await menu.getByRole("menuitem", { name: "Exclude all" }).click();
  await expect(menu).toBeVisible();
  await expect(button).toHaveText("Layers: None");

  await menu.getByRole("menuitem", { name: "Include all" }).click();
  await expect(button).toHaveText("Layers: All");

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(button).toHaveText("Layers: None");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(button).toHaveText(`Layers: ${count - 2} of ${count}`);
});
