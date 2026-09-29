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
