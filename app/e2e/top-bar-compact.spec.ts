import { expect, type Locator, type Page, test } from "@playwright/test";

// The desktop top bar is a compact menu bar (#1207): the File / Edit / Help
// row sets its height, and Export, the connection status, Share, the copy
// link icon and the Copied badge shrink to fit it, centered vertically. A
// browser tab gives the row 2px more room above and below (#1220) than the
// installed app does.

test.use({ viewport: { width: 1440, height: 900 } });

async function box(locator: Locator) {
  const result = await locator.boundingBox();
  if (!result) throw new Error("element has no box");
  return result;
}

async function expectFitsTopBar(page: Page, controls: Locator[]) {
  const bar = await box(page.locator(".topbar"));
  const menuItem = await box(
    page.getByRole("menubar").getByRole("menuitem").first(),
  );
  const barCenter = bar.y + bar.height / 2;
  for (const control of controls) {
    const { y, height } = await box(control);
    expect(y).toBeGreaterThanOrEqual(bar.y);
    expect(y + height).toBeLessThanOrEqual(bar.y + bar.height);
    expect(Math.abs(y + height / 2 - barCenter)).toBeLessThanOrEqual(1);
    // No taller than a few pixels over a menubar item, so it doesn't set
    // the bar's height.
    expect(height).toBeLessThanOrEqual(menuItem.height + 4);
  }
}

test("the top bar is about as tall as its menubar items", async ({ page }) => {
  await page.goto("/");
  const menuItem = await box(
    page.getByRole("menubar").getByRole("menuitem", { name: "File" }),
  );
  const bar = await box(page.locator(".topbar"));
  expect(bar.height).toBeLessThanOrEqual(40);
  expect(bar.height - menuItem.height).toBeLessThanOrEqual(16);
  // The buttons stay comfortable click targets.
  for (const name of ["Export", "Share"]) {
    const button = page.getByRole("button", { name, exact: true });
    expect((await box(button)).height).toBeGreaterThanOrEqual(24);
  }

  const right = page.locator(".topbar__group--right");
  await expectFitsTopBar(page, [
    right.getByRole("button", { name: "Export" }),
    right.locator(".collaboration-status"),
    right.getByRole("button", { name: "Share", exact: true }),
  ]);
});

test("the share link icon and Copied badge fit the compact bar", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("button", { name: "Start Sharing" }).click();
  const icon = page.locator(".share-link-icon-button");
  await expect(icon).toBeVisible({ timeout: 15_000 });
  await icon.click();
  const badge = page.locator(".share-copy-badge");
  await expect(badge).toBeVisible();

  await expectFitsTopBar(page, [
    page.getByRole("button", { name: "Stop Share" }),
    icon,
    badge,
  ]);
  expect((await box(page.locator(".topbar"))).height).toBeLessThanOrEqual(40);
});

test("the installed app's bar is just as compact without the logo", async ({
  page,
}) => {
  // Reports the page as an iOS home screen app, which hides the brand mark.
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "standalone", {
      configurable: true,
      get: () => true,
    });
  });
  await page.goto("/");
  await expect(page.locator(".topbar .brand-mark")).toBeHidden();
  expect((await box(page.locator(".topbar"))).height).toBeLessThanOrEqual(36);

  const right = page.locator(".topbar__group--right");
  await expectFitsTopBar(page, [
    right.getByRole("button", { name: "Export" }),
    right.getByRole("button", { name: "Share", exact: true }),
  ]);
});
