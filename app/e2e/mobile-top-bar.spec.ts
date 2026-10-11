// Stays in Playwright: it starts a real share against a signaling server (layout: MobileTopBar.component.test.tsx).
import { devices, expect, type Page, test } from "@playwright/test";
import { startSignalingServer } from "./signaling-server.ts";

// The phone top bar's Share control (#1175) at the narrowest portrait
// width the shell targets, with sharing pointed at a local signaling
// server.
const { defaultBrowserType: _, ...PHONE } = devices["Pixel 7"];

test.use({
  ...PHONE,
  viewport: { width: 375, height: 667 },
  permissions: ["clipboard-read", "clipboard-write"],
});

let signaling: Awaited<ReturnType<typeof startSignalingServer>>;

test.beforeAll(async () => {
  signaling = await startSignalingServer();
});

test.afterAll(async () => {
  await signaling.close();
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript((url) => {
    window.localStorage.setItem(
      "zvid-collaboration",
      JSON.stringify({ signaling: url }),
    );
  }, signaling.url);
  await page.goto("/");
  await expect(page.locator(".mobile-topbar")).toBeVisible();
});

function topBar(page: Page) {
  return page.locator(".mobile-topbar");
}

function shareButton(page: Page) {
  return topBar(page).locator(".mobile-share-button");
}

// Every control sits inside the bar, in order, without overlapping.
async function expectNothingClipped(page: Page) {
  const boxes = await topBar(page)
    .locator(":scope > button, :scope > h1")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        return {
          left: box.left,
          right: box.right,
          clipped:
            element.tagName === "BUTTON" &&
            element.scrollWidth > element.clientWidth,
        };
      }),
    );
  expect(boxes).toHaveLength(7);
  for (const [index, box] of boxes.entries()) {
    expect(box.clipped).toBe(false);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(375);
    if (index > 0) {
      expect(box.left).toBeGreaterThanOrEqual(boxes[index - 1].right);
    }
  }
}

test("Share starts a share, then offers the link, status and Stop Sharing", async ({
  page,
}) => {
  await expect(
    page.getByRole("button", { name: "More", exact: true }),
  ).toBeVisible();
  await shareButton(page).click();
  await expect(
    page.getByRole("heading", { name: "Share this session publicly?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start Sharing" }).click();

  // The control turns into the share's state, still fitting the bar.
  await expect(shareButton(page)).toHaveAttribute(
    "data-collaboration-mode",
    "sharing",
  );
  await expect(shareButton(page)).toHaveAccessibleName(
    /: Sharing, waiting for peer$/,
    { timeout: 15_000 },
  );
  await expectNothingClipped(page);
  const invite = await page.evaluate(() => navigator.clipboard.readText());
  await page.evaluate(() => navigator.clipboard.writeText(""));

  await shareButton(page).click();
  const sheet = page.getByRole("menu", { name: "Sharing" });
  await expect(
    sheet.getByRole("menuitem", { name: "Sharing, waiting for peer" }),
  ).toBeDisabled();
  await sheet.getByRole("menuitem", { name: "Copy Invite Link" }).click();
  await expect(sheet).toBeHidden();
  await expect(shareButton(page)).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    invite,
  );

  await shareButton(page).click();
  await sheet.getByRole("menuitem", { name: "Connection Details…" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  await shareButton(page).click();
  await sheet.getByRole("menuitem", { name: "Stop Sharing" }).click();
  await expect(shareButton(page)).toHaveText("Share");
  await expect(shareButton(page)).toHaveAttribute(
    "data-collaboration-mode",
    "idle",
  );
});
