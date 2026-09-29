import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// Middle-drag, or Space + left-drag, pans the timeline like a hand tool from
// anywhere in it, without selecting, editing clips or toggling playback.
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

async function setScrollLeft(page: Page, left: number) {
  await page.locator(".timeline-scroll").evaluate(
    (element, value) =>
      new Promise((resolve) => {
        element.scrollLeft = value;
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
    left,
  );
}

function scrollLeft(page: Page) {
  return page
    .locator(".timeline-scroll")
    .evaluate((element) => element.scrollLeft);
}

// Clip offset from its lane's start, which only a clip move changes.
async function clipOffset(clip: Locator, target: Locator) {
  const [clipBox, laneBox] = await Promise.all([
    clip.boundingBox(),
    target.boundingBox(),
  ]);
  if (!clipBox || !laneBox) {
    throw new Error("clip or lane is not visible");
  }
  return clipBox.x - laneBox.x;
}

async function drag(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  button: "left" | "middle",
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  await page.mouse.move(from.x + dx / 2, from.y, { steps: 3 });
  await page.mouse.move(from.x + dx, from.y, { steps: 3 });
  // Rest before releasing so the pan does not fling.
  await page.waitForTimeout(120);
  await page.mouse.up({ button });
}

test("middle-drag and Space-drag pan the timeline without editing it", async ({
  page,
}) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  await dropVideoIntoNewSourceTrack(page);

  await page.locator(".source-span").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy to layer" }).hover();
  await page.getByRole("menuitem", { name: "Layer 1" }).click();
  const target = lane(page, "1");
  const clip = target.locator(".clip-card");
  await expect(clip).toHaveCount(1);
  await target.scrollIntoViewIfNeeded();

  const scroller = page.locator(".timeline-scroll");
  expect(
    await scroller.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    ),
  ).toBeGreaterThan(400);
  const play = page.getByRole("button", { name: "Play timeline" });
  await expect(play).toBeVisible();
  const offsetBefore = await clipOffset(clip, target);

  // Middle-drag on empty lane space, right of the clip.
  await setScrollLeft(page, 400);
  const [laneBox, viewBox] = await Promise.all([
    target.boundingBox(),
    scroller.boundingBox(),
  ]);
  if (!laneBox || !viewBox) {
    throw new Error("lane is not visible");
  }
  const empty = { x: viewBox.x + viewBox.width - 80, y: laneBox.y + 20 };
  await drag(page, empty, 150, "middle");
  expect(await scrollLeft(page)).toBeCloseTo(250, -1);
  await expect(page.locator(".timeline-selection")).toHaveCount(0);
  await expect(scroller).not.toHaveClass(/is-grab-panning/);

  // Middle-drag over the clip pans instead of moving it.
  await setScrollLeft(page, 0);
  const clipBox = await clip.boundingBox();
  if (!clipBox) {
    throw new Error("clip is not visible");
  }
  const onClip = {
    x: clipBox.x + clipBox.width / 2,
    y: clipBox.y + clipBox.height / 2,
  };
  await drag(page, onClip, -120, "middle");
  expect(await scrollLeft(page)).toBeCloseTo(120, -1);
  expect(await clipOffset(clip, target)).toBe(offsetBefore);
  await expect(page.locator(".timeline-selection")).toHaveCount(0);

  // Space + left-drag pans and releasing Space does not start playback.
  await setScrollLeft(page, 0);
  await page.keyboard.down("Space");
  await expect(scroller).toHaveClass(/timeline-scroll--space-held/);
  await drag(page, empty, -200, "left");
  await page.keyboard.up("Space");
  expect(await scrollLeft(page)).toBeCloseTo(200, -1);
  await expect(page.locator(".timeline-selection")).toHaveCount(0);
  await expect(scroller).not.toHaveClass(/timeline-scroll--space-held/);
  await expect(play).toBeVisible();

  // A plain Space tap still toggles playback.
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("button", { name: "Pause playback" }),
  ).toBeVisible();
  await page.keyboard.press("Space");
  await expect(play).toBeVisible();

  // A plain left-drag on empty lane space still selects.
  await setScrollLeft(page, 0);
  const start = { x: empty.x - 200, y: empty.y };
  await drag(page, start, 100, "left");
  await expect(target.locator(".timeline-selection")).toBeVisible();
  expect(await scrollLeft(page)).toBe(0);
});
