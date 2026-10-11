import { expect, type Page, test } from "@playwright/test";

// Playwright, not a component test: it needs a live share started from the
// real app's Share flow, which is what shows and removes these buttons.
//
// The Copy share link buttons during a live share (the status bar button and
// the green link icon next to Stop Share). Starting a share builds the invite
// URL and tries to copy it once; the buttons stay until Stop Share. Their
// copy, confirmation and manual-copy fallback are covered by
// ShareLinkButton.component.test.tsx.

function copyLinkButton(page: Page) {
  return page
    .locator(".status-bar")
    .getByRole("button", { name: "Copy share link" });
}

function copyLinkIconButton(page: Page) {
  return page.locator(".share-link-icon-button");
}

async function startShare(page: Page) {
  await page.goto("/");
  await expect(copyLinkButton(page)).toHaveCount(0);
  await expect(copyLinkIconButton(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("button", { name: "Start Sharing" }).click();
  await expect(copyLinkButton(page)).toBeVisible({ timeout: 15_000 });
}

test("the share link buttons copy the invite until Stop Share", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await startShare(page);

  const url = await copyLinkButton(page).getAttribute("title");
  expect(url).toContain("room=");

  // The icon sits right after Stop Share.
  const icon = copyLinkIconButton(page);
  await expect(icon).toBeVisible();
  expect(
    await icon.evaluate(
      (node) => node.previousElementSibling?.textContent?.trim() ?? "",
    ),
  ).toBe("Stop Share");

  await page.evaluate(() => navigator.clipboard.writeText(""));
  await icon.click();
  await expect(page.locator(".share-copy-badge")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);

  await page.getByRole("button", { name: "Stop Share" }).click();
  await expect(copyLinkButton(page)).toHaveCount(0);
  await expect(copyLinkIconButton(page)).toHaveCount(0);
});

test("a failed copy at share start points to Copy share link", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new Error("Clipboard blocked")),
      },
    });
  });
  await startShare(page);

  await expect(page.locator(".status-bar__message")).toContainText(
    "Use Copy share link in the status bar",
  );
});
