import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// Selecting a source clip shows its Start, Length and Offset in the FX panel.
// A four-second test pattern at 120 BPM spans eight quarters, so two dropped
// together sit back to back at 0–8 and 8–16.
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

async function dropVideos(page: Page, count: number) {
  const base64 = (await readFile(VIDEO)).toString("base64");
  const dataTransfer = await page.evaluateHandle(
    ({ data, count }) => {
      const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      for (let index = 0; index < count; index += 1) {
        transfer.items.add(
          new File([bytes], `test-pattern-${index}.mp4`, { type: "video/mp4" }),
        );
      }
      return transfer;
    },
    { data: base64, count },
  );
  const target = '[aria-label="Source track drop area"]';
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(target, type, { dataTransfer });
  }
}

async function box(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (!bounds) {
    throw new Error("element is not visible");
  }
  return bounds;
}

// Where each span sits in its track, in quarters.
async function layout(spans: Locator, quarterPx: number) {
  return spans.evaluateAll(
    (elements, px) =>
      elements.map((element) => {
        const style = (element as HTMLElement).style;
        const startQ = Number.parseFloat(style.left) / px;
        const endQ = startQ + Number.parseFloat(style.width) / px;
        return [Math.round(startQ * 100) / 100, Math.round(endQ * 100) / 100];
      }),
    quarterPx,
  );
}

function field(page: Page, name: string) {
  return page
    .locator(".source-clip-properties")
    .getByRole("spinbutton", { name });
}

// Drags a field's up/down handle by `deltaY` pixels; up increases.
async function dragField(page: Page, name: string, deltaY: number) {
  const handle = field(page, name).locator(".time-value__handle");
  const bounds = await box(handle);
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + deltaY, { steps: 12 });
  await page.mouse.up();
}

async function typeField(page: Page, name: string, text: string) {
  await field(page, name).getByRole("button").click();
  const input = field(page, name).getByRole("textbox");
  await input.fill(text);
  await input.press("Enter");
}

const title = ".fx-panel__toggle";

test("source clip properties edit Start, Length and Offset, with undo", async ({
  page,
}) => {
  await page.goto("/");
  await dropVideos(page, 2);
  const spans = page.locator(".source-span");
  await expect(spans).toHaveCount(2, { timeout: 30_000 });
  const quarterPx = (await box(spans.first())).width / 8;
  await expect
    .poll(() => layout(spans, quarterPx))
    .toEqual([
      [0, 8],
      [8, 16],
    ]);

  // Selecting a source clip shows its properties in the current format,
  // ahead of its effects.
  await spans.first().click();
  await expect(page.locator(title)).toHaveText(/^Clip .+ Effects (.+)$/);
  await expect(page.locator(".source-clip-properties")).toBeVisible();
  const start = field(page, "Start");
  const length = field(page, "Length");
  const offset = field(page, "Offset");
  await expect(start).toHaveAttribute("aria-valuetext", "1.1.1");
  await expect(length).toHaveAttribute("aria-valuetext", "2.0.0");
  await expect(offset).toHaveAttribute("aria-valuetext", "0.0.0");

  // Switching the timeline to timecode shows the same values as timecode.
  await page.getByRole("button", { name: "Time", exact: true }).click();
  await expect(start).toHaveAttribute("aria-valuetext", "00:00:00");
  await expect(length).toHaveAttribute("aria-valuetext", "00:04:00");
  await page.getByRole("button", { name: "Tempo", exact: true }).click();
  await expect(length).toHaveAttribute("aria-valuetext", "2.0.0");

  // Typing a Start onto the next clip trims that clip like a drag would.
  await typeField(page, "Start", "2.1.1");
  await expect
    .poll(() => layout(spans, quarterPx))
    .toEqual([
      [4, 12],
      [12, 16],
    ]);
  await expect(start).toHaveAttribute("aria-valuenow", "4");

  // One undo reverts the one edit, and the field follows.
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(() => layout(spans, quarterPx))
    .toEqual([
      [0, 8],
      [8, 16],
    ]);
  await expect(start).toHaveAttribute("aria-valuenow", "0");

  // Length shrinks by dragging down.
  await dragField(page, "Length", 40);
  await expect(length).toHaveAttribute("aria-valuenow", "5.5");
  await expect
    .poll(() => layout(spans, quarterPx))
    .toEqual([
      [0, 5.5],
      [8, 16],
    ]);
  // The whole drag is one undo step.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(length).toHaveAttribute("aria-valuenow", "8");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(length).toHaveAttribute("aria-valuenow", "5.5");

  // Length runs on past the media's end, which loops it, and trims the next
  // clip like a drag would.
  await typeField(page, "Length", "3.0.0");
  await expect(length).toHaveAttribute("aria-valuenow", "12");
  await expect
    .poll(() => layout(spans, quarterPx))
    .toEqual([
      [0, 12],
      [12, 16],
    ]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(length).toHaveAttribute("aria-valuenow", "5.5");

  // Offset stops at the media's end going up, and at 0 going down.
  await dragField(page, "Offset", -200);
  await expect(offset).toHaveAttribute("aria-valuenow", "8");
  await dragField(page, "Offset", 400);
  await expect(offset).toHaveAttribute("aria-valuenow", "0");
  // Offset never moves the clip.
  expect(await layout(spans, quarterPx)).toEqual([
    [0, 5.5],
    [8, 16],
  ]);

  // Selecting a layer brings back its effects.
  await page.locator('[data-layer-header-id="1"] .track-label__select').click();
  await expect(page.locator(title)).toHaveText("Layer 1 Effects");
  await expect(page.locator(".source-clip-properties")).toHaveCount(0);
});

// The Clip widget's title row matches an FX device's: same height, a 1px
// divider, and the name inset from the rounded border like the fields.
test("the Clip widget title row matches an FX device title row", async ({
  page,
}) => {
  await page.goto("/");
  await dropVideos(page, 1);
  const spans = page.locator(".source-span");
  await expect(spans).toHaveCount(1, { timeout: 30_000 });
  await spans.first().click();

  const device = page.locator(".source-clip-properties__device");
  const clipTitle = device.locator(".fx-device-panel__title");
  await expect(clipTitle).toBeVisible();
  const clipHeight = (await box(clipTitle)).height;
  const nameInset =
    (await box(clipTitle.locator(".fx-device-panel__name"))).x -
    (await box(device)).x;
  expect(nameInset).toBeGreaterThanOrEqual(12);
  expect(
    await clipTitle.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.borderBottomWidth, style.borderBottomStyle];
    }),
  ).toEqual(["1px", "solid"]);

  await page.locator('[data-layer-header-id="1"] .track-label__select').click();
  const layoutTitle = page
    .locator('section[aria-label="Layout"]')
    .first()
    .locator(".fx-device-panel__title");
  await expect(layoutTitle).toBeVisible();
  expect(
    Math.abs((await box(layoutTitle)).height - clipHeight),
  ).toBeLessThanOrEqual(1);
});

// The Clip widget leads its title with an info icon and folds to a strip like
// an FX device, by its chevron, a title double-click or the strip, and stays
// folded across selecting other clips and reloading.
test("the Clip widget collapses like an FX device and remembers it", async ({
  page,
}) => {
  await page.goto("/");
  await dropVideos(page, 2);
  const spans = page.locator(".source-span");
  await expect(spans).toHaveCount(2, { timeout: 30_000 });
  await spans.first().click();

  const device = page.locator(".source-clip-properties__device");
  await expect(
    device.locator(".fx-device-panel__title .source-clip-properties__info svg"),
  ).toBeVisible();
  const collapse = device.getByRole("button", { name: "Collapse Clip" });
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await collapse.click();

  const strip = device.getByRole("button", { name: "Expand Clip" });
  await expect(device).toHaveClass(/fx-device-panel--collapsed/);
  await expect(strip).toHaveAttribute("aria-expanded", "false");
  await expect(
    device.locator(".source-clip-properties__info svg"),
  ).toBeVisible();
  await expect(field(page, "Start")).toHaveCount(0);

  // Another clip's widget is folded too.
  await spans.nth(1).click();
  await expect(device).toHaveClass(/fx-device-panel--collapsed/);

  // The fold survives a reload.
  await page.reload();
  await dropVideos(page, 1);
  await expect(spans).toHaveCount(1, { timeout: 30_000 });
  await spans.first().click();
  await expect(device).toHaveClass(/fx-device-panel--collapsed/);

  await strip.click();
  await expect(device).not.toHaveClass(/fx-device-panel--collapsed/);
  await expect(field(page, "Start")).toBeVisible();

  // Double-clicking the title row folds it as well.
  await device.locator(".fx-device-panel__name").dblclick();
  await expect(device).toHaveClass(/fx-device-panel--collapsed/);
});
