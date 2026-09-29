import { expect, type Page, test } from "@playwright/test";

// Double-clicking a text layer in the preview (or Enter on the selected one,
// or a double-click on its timeline clip) types on it directly on the canvas.
// The FX panel follows along, and leaving the editor is one undo step.

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

async function insertTextLayer(page: Page) {
  const bounds = await lane(page, "1").boundingBox();
  if (!bounds) {
    throw new Error("Lane is not visible");
  }
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + 40, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 150, y);
  await page.mouse.move(bounds.x + 260, y);
  await page.mouse.up();
  await page.mouse.click(bounds.x + 150, bounds.y + 20, { button: "right" });
  await page
    .getByRole("menu", { name: "Selection actions" })
    .getByRole("menuitem", { name: "Insert Text Layer" })
    .click();
  const clip = lane(page, "1").locator(".clip-card--text");
  await expect(clip).toHaveCount(1);
  // Clicking the clip moves the playhead onto it, so the preview shows it.
  await clip.locator(".clip-card__body").click();
  return clip;
}

// The centre of the letterboxed video, in page coordinates.
async function videoCenter(page: Page) {
  return page.locator(".composition-player__canvas").evaluate((canvas) => {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    };
  });
}

async function fontSize(page: Page) {
  return page
    .getByTestId("preview-text-editor")
    .getByRole("textbox")
    .evaluate((input) => Number.parseFloat(getComputedStyle(input).fontSize));
}

test("typing on a text layer in the preview", async ({ page }) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  const clip = await insertTextLayer(page);
  const device = page.locator('section[aria-label="Text"]');
  const fxText = device.getByRole("textbox", { name: "Text" });
  await expect(fxText).toHaveValue("Text");

  const editor = page.getByTestId("preview-text-editor");
  const input = editor.getByRole("textbox");
  await expect(editor).toHaveCount(0);

  // Double-clicking the layer puts a caret on the canvas, with the default
  // text selected so typing replaces it.
  const center = await videoCenter(page);
  await page.mouse.dblclick(center.x, center.y);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Text");
  await expect(input).toHaveAttribute("title", /whole text layer/);

  // Typing updates the Text effect as it goes: the FX panel and the clip.
  await page.keyboard.type("Hello");
  await page.keyboard.press("Enter");
  await page.keyboard.type("world");
  await expect(input).toHaveValue("Hello\nworld");
  await expect(fxText).toHaveValue("Hello\nworld");
  await expect(clip.locator("strong")).toHaveText("Hello");

  // Esc commits the edit, which undoes as one step.
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(fxText).toHaveValue("Text");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(fxText).toHaveValue("Hello\nworld");

  // Enter on the selected layer edits it too. The style shortcuts restyle
  // the whole layer, and Ctrl/Cmd+Enter commits.
  await page.mouse.click(center.x, center.y);
  await page.keyboard.press("Enter");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Hello\nworld");
  const bold = device.getByRole("button", { name: "Bold" });
  await expect(bold).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("ControlOrMeta+b");
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  await expect(input).toHaveCSS("font-weight", "700");
  const before = await fontSize(page);
  await page.keyboard.press("ControlOrMeta+Shift+Period");
  await expect.poll(() => fontSize(page)).toBeGreaterThan(before);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(editor).toHaveCount(0);

  // Changes in the FX panel show in the editor straight away.
  await page.mouse.dblclick(center.x, center.y);
  await expect(input).toBeFocused();
  await device.getByRole("button", { name: "Italic" }).click();
  await expect(editor).toHaveCount(1);
  await expect(input).toHaveCSS("font-style", "italic");

  // With Resize to fit on, the text shrinks as it grows.
  await device
    .getByRole("group", { name: "Resize to fit" })
    .getByRole("button", { name: "On" })
    .click();
  await input.click();
  const fitted = await fontSize(page);
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText(
    " and a great deal more text, enough to fill the whole box several times over, so that it has to shrink to fit".repeat(
      6,
    ),
  );
  await expect.poll(() => fontSize(page)).toBeLessThan(fitted);

  // A click outside the box commits.
  await lane(page, "1").click({ position: { x: 700, y: 10 } });
  await expect(editor).toHaveCount(0);
  await expect(fxText).toHaveValue(/shrink to fit$/);

  // Double-clicking the clip on the timeline edits it too; an empty text
  // keeps the clip and shows a placeholder in the editor only.
  await clip.locator(".clip-card__body").dblclick();
  await expect(input).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await expect(input).toHaveValue("");
  await expect(input).toHaveAttribute("placeholder", "Text");
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(lane(page, "1").locator(".clip-card--text")).toHaveCount(1);
  await expect(fxText).toHaveValue("");
});

test("an IME composition is one undo step with the rest of the edit", async ({
  page,
}) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  await insertTextLayer(page);
  const fxText = page
    .locator('section[aria-label="Text"]')
    .getByRole("textbox", { name: "Text" });

  const center = await videoCenter(page);
  await page.mouse.dblclick(center.x, center.y);
  const input = page.getByTestId("preview-text-editor").getByRole("textbox");
  await expect(input).toBeFocused();

  const session = await page.context().newCDPSession(page);
  for (const text of ["n", "に", "にほ", "にほん"]) {
    await session.send("Input.imeSetComposition", {
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
    });
  }
  await session.send("Input.insertText", { text: "日本" });
  await expect(input).toHaveValue("日本");
  await page.keyboard.type("語");
  await expect(fxText).toHaveValue("日本語");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("preview-text-editor")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(fxText).toHaveValue("Text");
});
