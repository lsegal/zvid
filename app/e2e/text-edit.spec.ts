import { expect, type Page, test } from "@playwright/test";
import { addLayers } from "./layers.ts";

// Double-clicking a text clip in the preview (or Enter on the selected one,
// or a double-click on its timeline clip) types on it directly on the canvas.
// The FX panel follows along, and leaving the editor is one undo step.

// The docked Audio row footer (#809) leaves less room for layers to scroll
// in; these tests' layers fit without scrolling at this size.
test.use({ viewport: { width: 1600, height: 1200 } });

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

// Adds Layer 2 ("2") to seek from, then a text clip on Layer 1.
async function insertTextClip(page: Page) {
  await addLayers(page, 1);
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
    .getByRole("menuitem", { name: "Insert Text Clip" })
    .click();
  const clip = lane(page, "1").locator(".clip-card--text");
  await expect(clip).toHaveCount(1);
  // Seek onto the clip from an empty layer so the preview shows it, then
  // select it. Selecting alone leaves the playhead where it is.
  const clipBox = await clip.boundingBox();
  const emptyLane = await lane(page, "2").boundingBox();
  if (!clipBox || !emptyLane) {
    throw new Error("Text clip is not visible");
  }
  await page.mouse.click(clipBox.x + clipBox.width / 2, emptyLane.y + 20);
  await clip.locator(".clip-card__body").click();
  return clip;
}

// The center of the letterboxed video, in page coordinates.
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

test("typing on a text clip in the preview", async ({ page }) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  const clip = await insertTextClip(page);
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
  await expect(input).toHaveAttribute("title", /whole text clip/);
  // The resize handles and origin marker step aside so they don't cover the
  // editor.
  const origin = page.getByTestId("preview-transform-origin");
  await expect(origin).toHaveCount(0);
  await expect(page.locator("[data-transform-handle]")).toHaveCount(0);

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
  await expect(origin).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(fxText).toHaveValue("Text");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(fxText).toHaveValue("Hello\nworld");

  // Enter on the selected layer edits it too. The style shortcuts restyle
  // the whole clip, and Ctrl/Cmd+Enter commits.
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

  // A click outside the box commits. It also deselects the clip, whose Text
  // device shows again once it is selected.
  await lane(page, "1").click({ position: { x: 700, y: 10 } });
  await expect(editor).toHaveCount(0);
  await clip.locator(".clip-card__body").click();
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
  await insertTextClip(page);
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

// Whether the selected layer's resize handles, rotation handle and origin
// marker are shown.
async function expectTransformHandles(page: Page, shown: boolean) {
  await expect(page.locator("[data-transform-handle]")).toHaveCount(
    shown ? 8 : 0,
  );
  await expect(page.getByTestId("preview-rotation-handle")).toHaveCount(
    shown ? 1 : 0,
  );
  await expect(page.getByTestId("preview-transform-origin")).toHaveCount(
    shown ? 1 : 0,
  );
}

// The outline's edge lengths and rotation, in CSS pixels and degrees.
async function outlineShape(page: Page) {
  const points = await page
    .getByTestId("preview-transform-outline")
    .getAttribute("points");
  const [topLeft, topRight, , bottomLeft] = (points ?? "")
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(",").map(Number));
  return {
    width: Math.round(
      Math.hypot(topRight[0] - topLeft[0], topRight[1] - topLeft[1]),
    ),
    height: Math.round(
      Math.hypot(bottomLeft[0] - topLeft[0], bottomLeft[1] - topLeft[1]),
    ),
    rotation: Math.round(
      (Math.atan2(topRight[1] - topLeft[1], topRight[0] - topLeft[0]) * 180) /
        Math.PI,
    ),
  };
}

async function centerOf(page: Page, testId: string) {
  const bounds = await page.getByTestId(testId).boundingBox();
  if (!bounds) {
    throw new Error(`${testId} is not visible`);
  }
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

test("the transform handles step aside while editing text", async ({
  page,
}) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  // The press points below are placed for a portrait canvas, where the text
  // box fills the preview's height.
  await page.keyboard.press("ControlOrMeta+,");
  const settings = page.getByRole("dialog", { name: "Session Settings" });
  await settings.getByRole("combobox", { name: "Canvas preset" }).click();
  await page.getByRole("option", { name: "1080×1920 9:16" }).click();
  await settings.getByRole("button", { name: "Apply" }).click();
  await expect(settings).toBeHidden();
  const clip = await insertTextClip(page);
  const editor = page.getByTestId("preview-text-editor");
  const input = editor.getByRole("textbox");
  const center = await videoCenter(page);

  await page.mouse.click(center.x, center.y);
  await expectTransformHandles(page, true);
  const shape = await outlineShape(page);

  // Each way out of the editor brings the handles back: Esc,
  // Ctrl/Cmd+Enter, a click outside and starting playback.
  const exits: [string, () => Promise<void>][] = [
    ["Escape", () => page.keyboard.press("Escape")],
    ["Ctrl/Cmd+Enter", () => page.keyboard.press("ControlOrMeta+Enter")],
    [
      "a click outside",
      () => page.locator(".timeline-toolbar").getByText("120 BPM").click(),
    ],
    [
      "playback",
      async () => {
        await page.getByRole("button", { name: "Play timeline" }).click();
        await expect(editor).toHaveCount(0);
        // Where a pause lands depends on the runner's speed, and a ruler
        // click while playing resumes playback once released. So let
        // playback run to the end of the clip and stop, then click the ruler
        // to move the playhead back onto the clip, which keeps the selection.
        const play = page.getByRole("button", { name: "Play timeline" });
        await expect(play).toBeVisible({ timeout: 15_000 });
        const clipBox = await clip.boundingBox();
        const ruler = await page.locator(".ruler-row__content").boundingBox();
        if (!clipBox || !ruler) {
          throw new Error("Text clip is not visible");
        }
        await page.mouse.click(
          clipBox.x + clipBox.width / 2,
          ruler.y + ruler.height / 2,
        );
        await expect(play).toBeVisible();
      },
    ],
  ];
  for (const [name, exit] of exits) {
    await test.step(name, async () => {
      await page.mouse.dblclick(center.x, center.y);
      await expect(input).toBeFocused();
      await expectTransformHandles(page, false);
      await exit();
      await expect(editor).toHaveCount(0);
      await expectTransformHandles(page, true);
    });
  }

  // While editing, dragging from where a resize handle or a corner's rotate
  // zone would be doesn't resize or rotate the layer. The press still ends
  // the edit, and moves the layer or clears the selection as usual. The zone
  // is beside the corner, as the text box fills the portrait preview's
  // height.
  const pressPoints: [string, () => Promise<{ x: number; y: number }>][] = [
    [
      "rotate zone",
      async () => {
        const corner = await centerOf(page, "preview-transform-handle-se");
        return { x: corner.x + 12, y: corner.y - 8 };
      },
    ],
    [
      "resize handle",
      async () => {
        // The handle straddles the box's edge; press its outer half so the
        // press lands beside the text box, not inside the editor.
        const handle = await centerOf(page, "preview-transform-handle-e");
        return { x: handle.x + 3, y: handle.y };
      },
    ],
  ];
  for (const [name, pressPoint] of pressPoints) {
    await test.step(`nothing from the ${name} while editing`, async () => {
      const from = await pressPoint();
      await page.mouse.dblclick(center.x, center.y);
      await expect(input).toBeFocused();
      await expectTransformHandles(page, false);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x - 40, from.y + 30, { steps: 5 });
      await page.mouse.up();
      await expect(editor).toHaveCount(0);
      await clip.locator(".clip-card__body").click();
      await expectTransformHandles(page, true);
      expect(await outlineShape(page)).toEqual(shape);
    });
  }
});
