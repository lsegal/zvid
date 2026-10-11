import { expect, type Page, test } from "@playwright/test";

// The desktop top bar keeps its left group (brand mark and menubar) and its
// right group (Export, connection status, Share) on one row whenever they fit
// side by side, and wraps the right group below only when they would touch
// (#1216).

async function box(page: Page, selector: string) {
  const found = await page.locator(selector).first().boundingBox();
  if (!found) throw new Error(`${selector} has no box`);
  return found;
}

async function layout(page: Page) {
  const [bar, left, right, padding] = await Promise.all([
    box(page, ".topbar"),
    box(page, ".topbar__group"),
    box(page, ".topbar__group--right"),
    page
      .locator(".topbar")
      .evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).paddingRight),
      ),
  ]);
  return { bar, left, right, padding };
}

// Both groups share a row, and the right group sits at the bar's right edge.
async function expectOneRow(page: Page) {
  const { bar, left, right, padding } = await layout(page);
  expect(
    Math.abs(right.y + right.height / 2 - (left.y + left.height / 2)),
  ).toBeLessThan(2);
  expect(right.x).toBeGreaterThan(left.x + left.width);
  expect(bar.x + bar.width - (right.x + right.width)).toBeCloseTo(padding, 0);
  // No taller than one row of content plus the bar's padding.
  expect(bar.height - Math.max(left.height, right.height)).toBeLessThanOrEqual(
    20,
  );
}

for (const width of [1100, 1240, 1440]) {
  test(`stays on one row at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await expect(page.getByRole("menubar")).toBeVisible();
    await expectOneRow(page);
  });
}

test("stays on one row at 1100px while sharing", async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("button", { name: "Start Sharing" }).click();
  await expect(page.getByRole("button", { name: "Stop Share" })).toBeVisible({
    timeout: 15_000,
  });
  await page.locator(".share-link-icon-button").click();
  await expect(page.locator(".share-copy-badge")).toBeVisible();
  await expectOneRow(page);
});

test("wraps the right group below, right-aligned, only once the groups touch", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("menubar")).toBeVisible();
  const { bar, left, right } = await layout(page);
  // The narrowest window that still fits both groups: the 16px gap between
  // them, the bar's padding (14px per side at these widths, ≤ 900px) and
  // whatever of the window lies outside the bar.
  const outside = 1100 - bar.width;
  const fits = Math.ceil(left.width + right.width + 16 + 28 + outside);
  expect(fits).toBeLessThan(880);

  await page.setViewportSize({ width: fits + 2, height: 800 });
  await expectOneRow(page);

  await page.setViewportSize({ width: fits - 20, height: 800 });
  const wrapped = await layout(page);
  expect(wrapped.right.y).toBeGreaterThanOrEqual(
    wrapped.left.y + wrapped.left.height,
  );
  expect(
    wrapped.bar.x + wrapped.bar.width - (wrapped.right.x + wrapped.right.width),
  ).toBeCloseTo(wrapped.padding, 0);
  expect(wrapped.left.x - wrapped.bar.x).toBeCloseTo(wrapped.padding, 0);
});
