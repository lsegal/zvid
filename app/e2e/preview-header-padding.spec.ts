import { expect, type Page, test } from "@playwright/test";

const HEADER_MIN_HEIGHT = 34;
const HEADER_INSET = 6;
const ITEM_GAP = 12;

function previewHandle(page: Page) {
  return page.getByRole("separator", { name: "Resize preview panel" });
}

// Header geometry, measured against the strip's padding box (inside its border).
function headerLayout(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector<HTMLElement>(
      ".preview-panel__header",
    );
    if (!header) {
      throw new Error("preview header is missing");
    }
    const box = header.getBoundingClientRect();
    const style = getComputedStyle(header);
    const innerLeft = box.left + Number.parseFloat(style.borderLeftWidth);
    const innerRight = box.right - Number.parseFloat(style.borderRightWidth);
    const items = [...header.children].map((child) => {
      const rect = child.getBoundingClientRect();
      return {
        className: child.className,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    });
    const clip = header.querySelector<HTMLElement>(".preview-panel__clip");
    return {
      height: box.height,
      innerLeft,
      innerRight,
      items,
      clipTruncated: clip ? clip.scrollWidth > clip.clientWidth : false,
      overflows: header.scrollWidth > header.clientWidth,
    };
  });
}

test("the preview header strip has even insets and gaps", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await expect(page.locator(".preview-panel__clip")).toBeVisible();

  const layout = await headerLayout(page);
  expect(layout.height).toBeGreaterThanOrEqual(HEADER_MIN_HEIGHT);

  const tabs = layout.items[0];
  const chip = layout.items[layout.items.length - 1];
  expect(tabs.className).toContain("preview-panel__tabs");
  expect(chip.className).toContain("preview-panel__mode");
  expect(Math.abs(tabs.left - layout.innerLeft - HEADER_INSET)).toBeLessThan(
    1.01,
  );
  expect(Math.abs(layout.innerRight - chip.right - HEADER_INSET)).toBeLessThan(
    1.01,
  );

  for (let index = 1; index < layout.items.length; index += 1) {
    const gap = layout.items[index].left - layout.items[index - 1].right;
    expect(gap).toBeGreaterThanOrEqual(ITEM_GAP - 0.5);
  }
});

test("a narrow preview ellipsizes the clip name on one line", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await expect(page.locator(".preview-panel__clip")).toHaveText(
    "No clip at playhead",
  );

  // Home narrows the preview to its minimum width.
  await previewHandle(page).focus();
  await page.keyboard.press("Home");
  await expect(previewHandle(page)).toHaveAttribute(
    "aria-valuenow",
    await previewHandle(page).getAttribute("aria-valuemin").then(String),
  );

  const layout = await headerLayout(page);
  expect(layout.clipTruncated).toBe(true);
  expect(layout.overflows).toBe(false);
  expect(layout.height).toBeGreaterThanOrEqual(HEADER_MIN_HEIGHT);
  // Everything shares one centered row inside the strip.
  const center = (item: { top: number; bottom: number }) =>
    (item.top + item.bottom) / 2;
  for (const item of layout.items) {
    expect(item.right).toBeLessThanOrEqual(
      layout.innerRight - HEADER_INSET + 1,
    );
    expect(item.bottom - item.top).toBeLessThan(layout.height);
    expect(Math.abs(center(item) - center(layout.items[0]))).toBeLessThan(1.5);
  }
});
