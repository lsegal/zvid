import { expect, type Page, test } from "@playwright/test";

// The status bar's Copy link button during a live share, driven in the real
// app. Starting a share builds the invite URL and tries to copy it once; the
// button copies it again at any time until Stop Share.

function copyLinkButton(page: Page) {
  return page.getByRole("button", { name: "Copy share link" });
}

async function startShare(page: Page) {
  await page.goto("/");
  await expect(copyLinkButton(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("button", { name: "Start Sharing" }).click();
  await expect(copyLinkButton(page)).toBeVisible({ timeout: 15_000 });
}

test("copies the invite from the status bar until Stop Share", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await startShare(page);

  const button = copyLinkButton(page);
  const url = await button.getAttribute("title");
  expect(url).toContain("room=");
  await expect(button).toHaveText("Copy link");

  await page.evaluate(() => navigator.clipboard.writeText(""));
  await button.click();
  await expect(button).toHaveText("Copied ✓");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  await expect(button).toHaveText("Copy link", { timeout: 5_000 });

  // Keyboard reachable.
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(button).toHaveText("Copied ✓");

  await page.getByRole("button", { name: "Stop Share" }).click();
  await expect(copyLinkButton(page)).toHaveCount(0);
});

test("offers the link for manual copy when the clipboard fails", async ({
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

  // The automatic copy at share start failed too; the status points here.
  await expect(page.locator(".status-bar__message")).toContainText(
    "Use Copy link in the status bar",
  );

  const button = copyLinkButton(page);
  const url = await button.getAttribute("title");
  await button.click();
  await expect(button).toHaveText("Copy failed");

  const fallback = page.getByRole("dialog", { name: "Share link" });
  const input = fallback.getByRole("textbox");
  await expect(input).toHaveValue(url ?? "");
  await expect(input).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(fallback).toHaveCount(0);
  await expect(button).toHaveText("Copy link");
  await expect(button).toBeFocused();
});
