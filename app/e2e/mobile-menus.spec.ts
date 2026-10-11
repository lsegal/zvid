import { devices, expect, type Page, test } from "@playwright/test";

// On a phone, dropdown menus open as the same bottom sheet as the
// timeline's long-press menu, with submenus shown in place behind a Back
// row (#1198). Tablets and desktops keep their popovers.
const { defaultBrowserType: _, ...PHONE } = devices["Pixel 7"];

test.use(PHONE);

async function openFx(page: Page) {
  await page.goto("/");
  const tabs = page.getByRole("navigation", { name: "Editor" });
  await tabs.getByRole("button", { name: "FX" }).click();
  const fx = page.locator(".fx-panel");
  await expect(fx).toBeVisible();
  return fx;
}

test("FX + opens a sheet whose categories open in place", async ({ page }) => {
  const fx = await openFx(page);
  await fx.getByRole("button", { name: "Add device to Global" }).click();
  const sheet = page.locator(".mobile-menu-sheet");
  await expect(sheet).toBeVisible();
  await expect(page.locator("[data-radix-popper-content-wrapper]")).toHaveCount(
    0,
  );
  await expect(sheet.locator(".mobile-menu-sheet__heading")).toHaveText([
    "Video",
    "Audio",
  ]);

  await sheet.getByRole("menuitem", { name: "Stylize" }).click();
  const back = sheet.locator(".mobile-menu-sheet__back");
  await expect(back).toHaveText("Stylize");
  // The categories give way to Stylize's effects.
  await expect(
    sheet.locator("[aria-haspopup='menu']", { hasText: "Stylize" }),
  ).toBeHidden();
  const pixelate = sheet.getByRole("menuitem", { name: /^Pixelate/ });
  await expect(pixelate).toBeVisible();
  // Each effect's row spans the sheet, so its description isn't squeezed
  // into a column beside the categories.
  const [row, panel] = await Promise.all([
    pixelate.boundingBox(),
    sheet.boundingBox(),
  ]);
  expect(row?.width ?? 0).toBeGreaterThan((panel?.width ?? 0) * 0.85);

  await back.click();
  await expect(back).toBeHidden();
  await expect(sheet.getByRole("menuitem", { name: "Stylize" })).toBeVisible();

  await sheet.getByRole("menuitem", { name: "Stylize" }).click();
  const devicesBefore = await fx.locator(".fx-device-panel").count();
  await pixelate.click();
  await expect(sheet).toBeHidden();
  await expect(fx.locator(".fx-device-panel")).toHaveCount(devicesBefore + 1);
  await expect(fx.getByRole("region", { name: "Pixelate" })).toBeVisible();
});

test("a long effect list scrolls inside the sheet", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 480 });
  const fx = await openFx(page);
  await fx.getByRole("button", { name: "Add device to Global" }).click();
  const sheet = page.locator(".mobile-menu-sheet");
  await sheet.getByRole("menuitem", { name: "Stylize" }).click();
  await expect(sheet.locator(".mobile-menu-sheet__back")).toBeVisible();
  // The rows scroll under the grabber, and the sheet stays on screen.
  const scroll = await sheet
    .locator(".mobile-menu-sheet__body")
    .evaluate((element) => ({
      overflows: element.scrollHeight > element.clientHeight,
      overscroll: getComputedStyle(element).overscrollBehaviorY,
    }));
  // Once it has slid up.
  await expect
    .poll(() => sheet.evaluate((element) => element.getAnimations().length))
    .toBe(0);
  const box = await sheet.boundingBox();
  expect(scroll.overflows).toBe(true);
  expect(scroll.overscroll).toBe("contain");
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(480 + 1);
  const last = sheet.getByRole("menuitem").last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
});

test("checkbox rows toggle in place, and the backdrop closes the sheet", async ({
  page,
}) => {
  const fx = await openFx(page);
  await fx.locator(".fx-layers__trigger").first().click();
  const sheet = page.locator(".mobile-menu-sheet");
  await expect(sheet).toBeVisible();
  const row = sheet.getByRole("menuitemcheckbox").first();
  await expect(row).toHaveAttribute("aria-checked", "true");
  await row.click();
  await expect(sheet).toBeVisible();
  await expect(row).toHaveAttribute("aria-checked", "false");
  await expect(fx.locator(".fx-layers__trigger").first()).not.toHaveText(
    "Layers: All",
  );
  await page.getByRole("button", { name: "Close menu" }).click();
  await expect(sheet).toBeHidden();
});

test.describe("tablet", () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test("keeps the add device popover menu", async ({ page }) => {
    const fx = page.locator(".fx-panel");
    await page.goto("/");
    await fx.getByRole("button", { name: "Add device to Global" }).click();
    await expect(page.locator(".mobile-menu-sheet")).toHaveCount(0);
    await expect(page.locator(".dropdown-menu-content")).toBeVisible();
  });
});
