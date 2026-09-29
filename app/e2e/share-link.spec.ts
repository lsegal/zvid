import { expect, type Page, test } from "@playwright/test";

// The Copy share link buttons during a live share (the status bar button and
// the green link icon next to Stop Share), driven in the real app. Starting a
// share builds the invite URL and tries to copy it once; either button copies
// it again at any time until Stop Share.

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

test("copies the invite from the status bar until Stop Share", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await startShare(page);

  const button = copyLinkButton(page);
  const url = await button.getAttribute("title");
  expect(url).toContain("room=");
  await expect(button).toHaveText("Copy share link");

  await page.evaluate(() => navigator.clipboard.writeText(""));
  await button.click();
  await expect(button).toHaveText("Copied ✓");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  await expect(button).toHaveText("Copy share link", { timeout: 5_000 });

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
    "Use Copy share link in the status bar",
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
  await expect(button).toHaveText("Copy share link");
  await expect(button).toBeFocused();
});

test("copies the invite from the link icon next to Stop Share", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await startShare(page);

  const icon = copyLinkIconButton(page);
  await expect(icon).toBeVisible();
  await expect(icon).toHaveAccessibleName("Copy share link");
  await expect(icon).toHaveAttribute("title", "Copy share link");
  const url = await copyLinkButton(page).getAttribute("title");

  // Placed right after Stop Share.
  expect(
    await icon.evaluate(
      (node) => node.previousElementSibling?.textContent?.trim() ?? "",
    ),
  ).toBe("Stop Share");

  await page.evaluate(() => navigator.clipboard.writeText(""));
  await icon.click();
  await expect(icon).toHaveClass(/share-link-icon-button--copied/);
  await expect(page.locator(".share-copy-badge")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  await expect(icon).toHaveClass(/share-link-icon-button--idle/, {
    timeout: 5_000,
  });

  // Keyboard reachable.
  await icon.focus();
  await page.keyboard.press("Enter");
  await expect(icon).toHaveClass(/share-link-icon-button--copied/);

  await page.getByRole("button", { name: "Stop Share" }).click();
  await expect(copyLinkIconButton(page)).toHaveCount(0);
});

test("offers the link for manual copy when the icon's copy fails", async ({
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

  const icon = copyLinkIconButton(page);
  const url = await copyLinkButton(page).getAttribute("title");
  await icon.click();
  await expect(icon).toHaveClass(/share-link-icon-button--failed/);

  const fallback = page.getByRole("dialog", { name: "Share link" });
  const input = fallback.getByRole("textbox");
  await expect(input).toHaveValue(url ?? "");
  await expect(input).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(fallback).toHaveCount(0);
  await expect(icon).toHaveClass(/share-link-icon-button--idle/);
  await expect(icon).toBeFocused();
});
