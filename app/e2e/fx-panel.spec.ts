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
