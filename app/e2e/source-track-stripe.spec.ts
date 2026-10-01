import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// A source track's color stripe is square and flush with its label's left
// edge, spanning the row's full height, on track rows and the new-track row.
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

async function expectFlushStripe(row: Locator) {
  const geometry = await row.evaluate((row) => {
    const label = row.querySelector(".track-label");
    const stripe = label?.querySelector(".track-label__stripe");
    if (!label || !stripe) throw new Error("missing label or stripe");
    const box = (element: Element) => element.getBoundingClientRect();
    return {
      row: box(row),
      label: box(label),
      stripe: box(stripe),
      radius: getComputedStyle(stripe).borderRadius,
    };
  });
  expect(geometry.stripe.left).toBe(geometry.label.left);
  expect(geometry.stripe.top).toBe(geometry.row.top);
  expect(geometry.stripe.bottom).toBe(geometry.row.bottom);
  expect(geometry.stripe.width).toBe(4);
  expect(geometry.radius).toBe("0px");
}

test("source track stripes are flush, square and full height", async ({
  page,
}) => {
  await page.goto("/");
  const dataTransfer = await videoTransfer(page);
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(header, type, { dataTransfer });
  }
  await expect(page.locator(tracks)).toHaveCount(1, { timeout: 30_000 });
  await expectFlushStripe(page.locator(".track-row--source").first());

  for (const type of ["dragenter", "dragover"]) {
    await page.dispatchEvent(tracks, type, { dataTransfer });
  }
  const dropRow = page.locator(".track-row--source-drop");
  await expect(dropRow).toBeVisible();
  await expectFlushStripe(dropRow);
});
