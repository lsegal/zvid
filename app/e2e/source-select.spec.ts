import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// Source tracks and source clips are selected like layers and clips, and
// only one thing in the timeline is selected at a time.
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

async function dropVideoIntoNewSourceTrack(page: Page) {
  const base64 = (await readFile(VIDEO)).toString("base64");
  const dataTransfer = await page.evaluateHandle((data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([bytes], "test-pattern.mp4", { type: "video/mp4" }),
    );
    return transfer;
  }, base64);
  const target = '[data-source-track-drop-target="new-track"]';
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(target, type, { dataTransfer });
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
}

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

const sourceRow = '[data-source-track-drop-target="track"]';

async function expectNoLayerSelected(page: Page) {
  await expect(
    page.locator(".arrangement-lanes .track-row--selected"),
  ).toHaveCount(0);
  await expect(page.locator(".clip-card--selected")).toHaveCount(0);
}

test("selects source tracks and source clips instead of layers and clips", async ({
  page,
}) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  await dropVideoIntoNewSourceTrack(page);
  const label = page.locator(".track-label--source");
  const labelName = label.locator(".track-label__select");
  const span = page.locator(".source-span");
  const row = page.locator(sourceRow);

  // Put a clip on Layer 1 and select it.
  await span.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy to layer" }).hover();
  await page.getByRole("menuitem", { name: "Layer 1" }).click();
  const clip = lane(page, "1").locator(".clip-card");
  await expect(clip).toHaveCount(1);
  await clip.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await clip.locator(".clip-card__body").click();
  await expect(clip).toHaveClass(/clip-card--selected/);
  await expect(span).not.toHaveClass(/source-span--selected/);

  // The source track's label selects the track, and no layer or clip.
  await label.click();
  await expect(row).toHaveClass(/track-row--selected/);
  await expect(labelName).toHaveAttribute("aria-current", "true");
  await expect(span).not.toHaveClass(/source-span--selected/);
  await expectNoLayerSelected(page);
  // The FX panel shows no layer's effects.
  await expect(
    page.getByText("Select a layer to see its effects"),
  ).toBeVisible();

  // A source clip selects the clip and makes its track the active one.
  await span.click();
  await expect(span).toHaveClass(/source-span--selected/);
  await expect(row).toHaveClass(/track-row--selected/);
  await expectNoLayerSelected(page);

  // Empty space in the row clears the source clip, keeping its track.
  const spanBox = await span.boundingBox();
  const rowBox = await row.locator(".track-row__content--source").boundingBox();
  if (!spanBox || !rowBox) {
    throw new Error("source track is not visible");
  }
  await page.mouse.click(
    spanBox.x + spanBox.width + 40,
    rowBox.y + rowBox.height / 2,
  );
  await expect(span).not.toHaveClass(/source-span--selected/);
  await expect(row).toHaveClass(/track-row--selected/);

  // Selecting an arrangement clip clears the source selection.
  await span.click();
  await expect(span).toHaveClass(/source-span--selected/);
  await clip.locator(".clip-card__body").click();
  await expect(clip).toHaveClass(/clip-card--selected/);
  await expect(span).not.toHaveClass(/source-span--selected/);
  await expect(row).not.toHaveClass(/track-row--selected/);
  await expect(labelName).not.toHaveAttribute("aria-current", "true");
});

test("Ctrl/Cmd-click on a source clip still adds it to the arrangement", async ({
  page,
}) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  await dropVideoIntoNewSourceTrack(page);
  await page.locator(".source-span").click({ modifiers: ["ControlOrMeta"] });
  await expect(page.locator(".clip-card")).toHaveCount(1);
  await expect(page.locator(".clip-card")).toHaveClass(/clip-card--selected/);
  await expect(page.locator(".source-span")).not.toHaveClass(
    /source-span--selected/,
  );
});

test("right-clicking a source clip selects it and opens its menu", async ({
  page,
}) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  await dropVideoIntoNewSourceTrack(page);
  await page.locator(".source-span").click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Copy to layer" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".source-span")).toHaveClass(
    /source-span--selected/,
  );
  await expectNoLayerSelected(page);
});
