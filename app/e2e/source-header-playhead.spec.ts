import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// The playhead line spans the whole timeline canvas and is drawn across the
// Source Tracks group header row, like the lanes above and rows below (#968).
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

test.use({ viewport: { width: 1600, height: 1200 } });

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

// Seeks by clicking empty space in layer lane 5, `offset` px into it.
async function seek(page: Page, offset: number) {
  const lane = page.locator('[data-timeline-lane-id="5"]');
  await lane.scrollIntoViewIfNeeded();
  const bounds = await lane.boundingBox();
  if (!bounds) {
    throw new Error("Lane is not visible");
  }
  await page.mouse.click(bounds.x + offset, bounds.y + 20);
}

// What paints topmost at the playhead line's x, in the middle of `selector`.
// The line ignores pointer events, so turn them on to let elementFromPoint
// see it wherever it is on top.
async function topmostAtPlayhead(page: Page, selector: string) {
  await page
    .locator(selector)
    .first()
    .evaluate((element) => element.scrollIntoView({ block: "center" }));
  await page.addStyleTag({
    content: ".timeline-playhead { pointer-events: auto !important; }",
  });
  return page.evaluate((target) => {
    const line = document.querySelector(".timeline-playhead") as HTMLElement;
    const element = document.querySelector(target) as HTMLElement;
    const lineBox = line.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    const x = lineBox.left + lineBox.width / 2;
    if (x < box.left || x > box.right) {
      throw new Error(`playhead x ${x} is outside ${target}`);
    }
    const hit = document.elementFromPoint(x, box.top + box.height / 2);
    return {
      playhead: Boolean(hit?.closest(".timeline-playhead")),
      header: Boolean(hit?.closest(".source-header__content")),
    };
  }, selector);
}

test("the playhead line shows over the empty source header", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".source-header--empty")).toBeVisible();
  await seek(page, 300);

  expect(await topmostAtPlayhead(page, ".source-header__content")).toEqual({
    playhead: true,
    header: false,
  });
});

test("the playhead line shows over the source header with tracks", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".source-header")).toBeVisible();
  await dropVideoIntoNewSourceTrack(page);
  await expect(page.locator(".source-header--empty")).toHaveCount(0);
  await seek(page, 300);

  expect(await topmostAtPlayhead(page, ".source-header__content")).toEqual({
    playhead: true,
    header: false,
  });
  expect(
    await topmostAtPlayhead(page, ".track-row__content--source"),
  ).toMatchObject({ playhead: true });

  await page.locator(".source-header__toggle").click();
  await expect(page.locator(".source-header--collapsed")).toBeVisible();
  expect(await topmostAtPlayhead(page, ".source-header__content")).toEqual({
    playhead: true,
    header: false,
  });
});

test("the source header drop target keeps its highlight", async ({ page }) => {
  await page.goto("/");
  const content = page.locator(".source-header__content");
  await expect(content).toBeVisible();
  const base = await content.evaluate(
    (element) => getComputedStyle(element).backgroundImage,
  );
  await page.locator(".source-header").evaluate((element) => {
    element.classList.add("is-drop-target");
  });
  const highlighted = await content.evaluate(
    (element) => getComputedStyle(element).backgroundImage,
  );
  expect(highlighted).not.toBe(base);
  expect(highlighted).toContain("rgba(124, 161, 255, 0.14)");
});
