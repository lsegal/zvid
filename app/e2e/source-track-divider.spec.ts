import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// Source track labels draw the same right-edge divider as the layer and
// Audio rows, so the label column reads as one continuous vertical line, and
// the same bottom divider between rows, continuous with the row content's.
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

function border(locator: Locator, side: "Right" | "Bottom") {
  return locator.evaluate((element, side) => {
    const style = getComputedStyle(element);
    return {
      width: style.getPropertyValue(`border-${side.toLowerCase()}-width`),
      style: style.getPropertyValue(`border-${side.toLowerCase()}-style`),
      color: style.getPropertyValue(`border-${side.toLowerCase()}-color`),
    };
  }, side);
}

function rightBorder(locator: Locator) {
  return border(locator, "Right");
}

function bottomBorder(locator: Locator) {
  return border(locator, "Bottom");
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

test("source track labels have the layer rows' bottom divider", async ({
  page,
}) => {
  await page.goto("/");
  const dataTransfer = await videoTransfer(page);
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(header, type, { dataTransfer });
  }
  await expect(page.locator(tracks)).toHaveCount(1, { timeout: 30_000 });
  for (const type of ["dragenter", "dragover"]) {
    await page.dispatchEvent(tracks, type, { dataTransfer });
  }
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(".track-row--source-drop", type, {
      dataTransfer,
    });
  }
  await expect(page.locator(tracks)).toHaveCount(2, { timeout: 30_000 });

  const lane = page.locator(".track-label--lane").first();
  const layer = await bottomBorder(lane);
  expect(layer.width).toBe("1px");
  expect(layer.style).toBe("solid");
  const layerRight = await rightBorder(lane);

  const labels = page.locator(`${tracks} .track-label--source`);
  for (const label of await labels.all()) {
    expect(await bottomBorder(label)).toEqual(layer);
    expect(await rightBorder(label)).toEqual(layerRight);
  }

  const first = page.locator(tracks).first();
  const labelBox = await first.locator(".track-label--source").boundingBox();
  const contentBox = await first
    .locator(".track-row__content--source")
    .boundingBox();
  expect(labelBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  expect(
    Math.abs(
      (labelBox?.y ?? 0) +
        (labelBox?.height ?? 0) -
        ((contentBox?.y ?? 0) + (contentBox?.height ?? 0)),
    ),
  ).toBeLessThan(0.5);
});
