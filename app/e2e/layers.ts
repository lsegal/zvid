import { expect, type Page } from "@playwright/test";

// A new session starts with one layer, Layer 1 ("1"). Specs that need more
// insert them below it from its header menu: Layer 2 is "2" and Layer 3 is
// "3".
export async function addLayers(page: Page, count = 2) {
  const headers = page.locator("[data-layer-header-id]");
  await expect(headers).toHaveCount(1);
  for (let index = 1; index <= count; index += 1) {
    const last = headers.last();
    await last.scrollIntoViewIfNeeded();
    await last.click({ button: "right" });
    await page
      .getByRole("menu", { name: "Layer header actions" })
      .getByRole("menuitem", { name: "Insert layer below", exact: true })
      .click();
    await expect(headers).toHaveCount(index + 1);
  }
  await expect(
    page.locator(`[data-layer-header-id="${count + 1}"]`),
  ).toHaveCount(1);
}
