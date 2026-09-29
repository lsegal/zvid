import { expect, type Page, test } from "@playwright/test";

// The selection menu's Insert Text Clip turns the timeline selection into a
// text clip, styled from the FX panel by its layer's Text effect.

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

async function dragSelection(
  page: Page,
  laneId: string,
  fromX: number,
  toX: number,
) {
  const bounds = await lane(page, laneId).boundingBox();
  if (!bounds) {
    throw new Error("Lane is not visible");
  }
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + fromX, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + (fromX + toX) / 2, y);
  await page.mouse.move(bounds.x + toX, y);
  await page.mouse.up();
}

async function insertTextClip(page: Page) {
  await dragSelection(page, "1", 40, 260);
  const bounds = await lane(page, "1").boundingBox();
  if (!bounds) {
    throw new Error("Lane is not visible");
  }
  await page.mouse.click(bounds.x + 150, bounds.y + 20, { button: "right" });
  await page
    .getByRole("menu", { name: "Selection actions" })
    .getByRole("menuitem", { name: "Insert Text Clip" })
    .click();
}

test("Insert Text Clip adds a text clip edited from its Text effect", async ({
  page,
}) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  await insertTextClip(page);

  const clip = lane(page, "1").locator(".clip-card--text");
  await expect(clip).toHaveCount(1);
  await expect(clip).toHaveClass(/clip-card--selected/);
  await expect(clip.locator(".clip-card__glyph")).toHaveText("T");
  await expect(clip.locator("strong")).toHaveText("Text");
  await expect(page.locator(".timeline-selection")).toHaveCount(0);

  const device = page.locator('section[aria-label="Text"]');
  await expect(device).toBeVisible();

  // Typing updates the clip's first line as it goes, and leaving the field
  // commits the edit as one undo step.
  const text = device.getByRole("textbox", { name: "Text" });
  await text.fill("Hello there\nSecond line");
  await expect(clip.locator("strong")).toHaveText("Hello there");
  await text.blur();

  // Style toggles and a segmented alignment.
  const italic = device.getByRole("button", { name: "Italic" });
  await italic.click();
  await expect(italic).toHaveAttribute("aria-pressed", "true");
  const right = device
    .getByRole("group", { name: "Align" })
    .getByRole("button", { name: "Right" });
  await right.click();
  await expect(right).toHaveAttribute("aria-pressed", "true");

  // Every weight for Inter.
  const weight = device.getByRole("combobox", { name: "Weight" });
  await expect(weight.locator("option")).toHaveCount(9);

  // The font list is searchable; each row previews its font.
  await device.getByRole("button", { name: "Font: Inter" }).click();
  const picker = page.locator(".font-picker");
  await expect(picker).toBeVisible();
  await expect(picker.getByText("Bundled")).toBeVisible();
  await expect(picker.getByText("Google Fonts")).toBeVisible();
  await picker.getByPlaceholder("Search fonts").fill("anto");
  const anton = picker.getByRole("option", { name: "Anton" });
  await expect(anton.locator(".font-picker__preview")).toHaveCSS(
    "font-family",
    /Anton/,
  );
  await anton.click();
  await expect(picker).toHaveCount(0);
  await expect(
    device.getByRole("button", { name: "Font: Anton" }),
  ).toBeVisible();
  // Anton only has a regular weight.
  await expect(weight.locator("option")).toHaveText(["Regular"]);

  // Gradient fill swaps the colour swatch for a gradient one; the shadow
  // controls show once it is on.
  await device
    .getByRole("group", { name: "Fill" })
    .getByRole("button", { name: "Gradient" })
    .click();
  await expect(
    device.getByRole("button", { name: "Edit Gradient" }),
  ).toBeVisible();
  await expect(device.getByRole("button", { name: "Edit Color" })).toHaveCount(
    0,
  );
  await expect(device.getByText("Blur")).toHaveCount(0);
  await device
    .getByRole("group", { name: "Shadow" })
    .getByRole("button", { name: "On" })
    .click();
  await expect(device.getByText("Blur", { exact: true })).toBeVisible();

  // Resize to fit is a toggle.
  const fit = device.getByRole("group", { name: "Resize to fit" });
  await fit.getByRole("button", { name: "On" }).click();
  await expect(fit.getByRole("button", { name: "On" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Undo steps back through the seven edits, text last, then removes the
  // clip and its Text effect.
  for (let step = 0; step < 7; step += 1) {
    await page.keyboard.press("ControlOrMeta+z");
  }
  await expect(clip.locator("strong")).toHaveText("Text");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(lane(page, "1").locator(".clip-card--text")).toHaveCount(0);
});
