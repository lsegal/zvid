import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// Source track labels draw the same right-edge divider as the layer and
// Audio rows, so the label column reads as one continuous vertical line.
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

const header = '[aria-label="Source track drop area"]';
const tracks = '[data-source-track-drop-target="track"]';

async function videoTransfer(page: Page) {
  const base64 = (await readFile(VIDEO)).toString("base64");
  return page.evaluateHandle((base64) => {
    const transfer = new DataTransfer();
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    transfer.items.add(
      new File([bytes], "test-pattern.mp4", { type: "video/mp4" }),
    );
    return transfer;
  }, base64);
}

function rightBorder(locator: Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      width: style.borderRightWidth,
      style: style.borderRightStyle,
      color: style.borderRightColor,
    };
  });
}

test("source track labels have the layer rows' right divider", async ({
  page,
}) => {
  await page.goto("/");
  const dataTransfer = await videoTransfer(page);
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(header, type, { dataTransfer });
  }
  await expect(page.locator(tracks)).toHaveCount(1, { timeout: 30_000 });

  const layer = await rightBorder(page.locator(".track-label--lane").first());
  expect(layer.width).toBe("1px");
  expect(layer.style).toBe("solid");

  const source = page.locator(`${tracks} .track-label--source`);
  expect(await rightBorder(source)).toEqual(layer);

  for (const type of ["dragenter", "dragover"]) {
    await page.dispatchEvent(tracks, type, { dataTransfer });
  }
  const dropRow = page.locator(".track-label--source-drop");
  await expect(dropRow).toBeVisible();
  expect(await rightBorder(dropRow)).toEqual(layer);
});
