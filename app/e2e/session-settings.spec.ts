import { expect, type Page, test } from "@playwright/test";

// File ▸ Session Settings…, the status bar resolution and Ctrl/Cmd+, open a
// dialog that sets the session's canvas, frame rate and encoding.

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
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Session Settings…" }).click();
  const settings = dialog(page);
  await expect(settings).toBeVisible();

  await settings
    .getByRole("combobox", { name: "Canvas preset" })
    .selectOption("1080x1920");
  await expect(settings.getByLabel("Canvas width")).toHaveValue("1080");
  await expect(settings.getByLabel("Canvas height")).toHaveValue("1920");
  await settings.getByRole("combobox", { name: "Frame rate" }).selectOption({
    label: "60 fps",
  });
  await settings.getByRole("button", { name: "Apply" }).click();

  await expect(settings).toBeHidden();
  await expect(resolutionItem(page)).toContainText("1080x1920 · 60 fps");

  await page.keyboard.press("Control+z");
  await expect(resolutionItem(page)).toContainText("1920x1080 · 30 fps");
});

test("the status bar resolution opens the dialog, which validates sizes", async ({
  page,
}) => {
  await resolutionItem(page).click();
  const settings = dialog(page);
  await expect(settings).toBeVisible();

  await settings.getByRole("button", { name: "Unlock aspect ratio" }).click();
  await settings.getByLabel("Canvas width").fill("1921");
  await expect(
    settings.getByText("Must be even for video encoders."),
  ).toBeVisible();
  await expect(settings.getByRole("button", { name: "Apply" })).toBeDisabled();

  await settings.getByRole("button", { name: "Cancel" }).click();
  await expect(settings).toBeHidden();
  await expect(resolutionItem(page)).toContainText("1920x1080 · 30 fps");
});

test("Ctrl+, opens the dialog", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await expect(dialog(page)).toBeVisible();
});
