import { expect, type Page, test } from "@playwright/test";

// Playwright, not a component test: it checks the app's File menu, status bar
// and undo history around the dialog.
//
// File ▸ Session Settings… and the status bar resolution open a dialog that
// sets the session's canvas, frame rate and encoding. The dialog itself
// (presets, validation, Ctrl/Cmd+,) is covered by
// SessionSettingsDialog.component.test.tsx.

function resolutionItem(page: Page) {
  return page.locator(".status-bar__item--button", { hasText: "Res" });
}

function dialog(page: Page) {
  return page.getByRole("dialog", { name: "Session Settings" });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(resolutionItem(page)).toContainText("1920x1080 · 30 fps");
});

test("File ▸ Session Settings applies canvas and frame rate as one undo step", async ({
  page,
}) => {
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Session Settings…" }).click();
  const settings = dialog(page);
  await expect(settings).toBeVisible();

  await settings.getByRole("combobox", { name: "Canvas preset" }).click();
  await page.getByRole("option", { name: "1080×1920 9:16" }).click();
  await expect(settings.getByLabel("Canvas width")).toHaveValue("1080");
  await expect(settings.getByLabel("Canvas height")).toHaveValue("1920");
  await settings.getByRole("combobox", { name: "Frame rate" }).click();
  await page.getByRole("option", { name: "60 fps", exact: true }).click();
  await settings.getByRole("button", { name: "Apply" }).click();

  await expect(settings).toBeHidden();
  await expect(resolutionItem(page)).toContainText("1080x1920 · 60 fps");

  await page.keyboard.press("ControlOrMeta+z");
  await expect(resolutionItem(page)).toContainText("1920x1080 · 30 fps");
});

test("the status bar resolution opens the dialog, and Cancel changes nothing", async ({
  page,
}) => {
  await resolutionItem(page).click();
  const settings = dialog(page);
  await expect(settings).toBeVisible();

  await settings.getByRole("combobox", { name: "Frame rate" }).click();
  await page.getByRole("option", { name: "60 fps", exact: true }).click();
  await settings.getByRole("button", { name: "Cancel" }).click();
  await expect(settings).toBeHidden();
  await expect(resolutionItem(page)).toContainText("1920x1080 · 30 fps");
});
