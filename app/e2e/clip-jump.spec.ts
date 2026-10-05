import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { addLayers } from "./layers.ts";

// Ctrl-click on an arrangement clip (Cmd-click on macOS) selects it and
// moves the playhead to its start, seeking playback while it plays. Source
// clips keep Ctrl/Cmd-click for dropping onto the arrangement, and Ctrl-click
// on macOS stays a right-click.
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

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

// The playhead's and the clip's left edges within the lane, independent of
// scroll.
async function playheadX(page: Page) {
  return page.evaluate(() => {
    const marker = document.querySelector(
      ".timeline-playhead-marker",
    ) as HTMLElement;
    const content = document.querySelector(
      "[data-timeline-lane-id]",
    ) as HTMLElement;
    return (
      marker.getBoundingClientRect().left - content.getBoundingClientRect().left
    );
  });
}

// The marker's left edge sits a couple of pixels off a clip's border.
async function distanceToClipStart(page: Page, startX: number) {
  return Math.abs((await playheadX(page)) - startX);
}

async function clipX(page: Page, clip: Locator) {
  const [clipBox, laneBox] = await Promise.all([
    clip.boundingBox(),
    page.locator("[data-timeline-lane-id]").first().boundingBox(),
  ]);
  if (!clipBox || !laneBox) {
    throw new Error("timeline is not visible");
  }
  return clipBox.x - laneBox.x;
}

// A plain click on another layer, under the middle of the clip, seeks there
// without selecting the clip.
async function seekIntoClip(page: Page, clip: Locator, otherLane: Locator) {
  // Back to the top, so the sticky ruler doesn't cover the lane once the
  // timeline has scrolled down to the source clip.
  await page.locator(".timeline-scroll").evaluate((element) => {
    element.scrollTop = 0;
  });
  const [clipBox, laneBox] = await Promise.all([
    clip.boundingBox(),
    otherLane.boundingBox(),
  ]);
  if (!clipBox || !laneBox) {
    throw new Error("timeline is not visible");
  }
  await page.mouse.click(clipBox.x + clipBox.width / 2, laneBox.y + 20);
}

async function addVideoClip(page: Page, modifier: "ControlOrMeta" | "Meta") {
  await dropVideoIntoNewSourceTrack(page);
  // Ctrl/Cmd-click on a source clip still drops it on the arrangement.
  await page.locator(".source-span").click({ modifiers: [modifier] });
  const clip = page.locator(".clip-card");
  await expect(clip).toHaveCount(1);
  await expect(page.locator(".preview-placeholder")).toHaveCount(0, {
    timeout: 30_000,
  });
  return clip;
}

test.use({ viewport: { width: 1600, height: 1200 } });

test("Ctrl/Cmd-click on a clip selects it and jumps the playhead to its start", async ({
  page,
}) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  // An empty layer to click in, apart from the clip's.
  await addLayers(page, 1);
  const clip = await addVideoClip(page, "ControlOrMeta");
  const clipLane = clip.locator("xpath=ancestor::*[@data-timeline-lane-id]");
  const laneId = await clipLane.getAttribute("data-timeline-lane-id");
  const otherLane = page
    .locator("[data-timeline-lane-id]")
    .filter({ hasNot: page.locator(".clip-card") })
    .first();
  const body = clip.locator(".clip-card__body");
  await expect(body).toHaveAttribute("title", /\+click to jump to start/);

  const startX = await clipX(page, clip);
  await seekIntoClip(page, clip, otherLane);
  await expect(clip).not.toHaveClass(/clip-card--selected/);
  await expect.poll(() => playheadX(page)).toBeGreaterThan(startX + 40);

  // Stopped: the playhead jumps to the clip start and the clip is selected.
  const bodyBox = await body.boundingBox();
  if (!bodyBox) {
    throw new Error("clip is not visible");
  }
  // Well past the clip start, clear of the trim handles.
  const jumpPoint = { x: bodyBox.width * 0.75, y: bodyBox.height / 2 };
  await body.click({ position: jumpPoint, modifiers: ["ControlOrMeta"] });
  await expect(clip).toHaveClass(/clip-card--selected/);
  await expect.poll(() => distanceToClipStart(page, startX)).toBeLessThan(3);
  // The click neither duplicated nor moved the clip.
  await expect(page.locator(".clip-card")).toHaveCount(1);
  expect(await clipX(page, clip)).toBe(startX);
  expect(await clipLane.getAttribute("data-timeline-lane-id")).toBe(laneId);

  // Playing: playback seeks to the clip start and keeps going.
  await seekIntoClip(page, clip, otherLane);
  await expect.poll(() => playheadX(page)).toBeGreaterThan(startX + 40);
  await page.getByRole("button", { name: "Play timeline" }).click();
  const pause = page.getByRole("button", { name: "Pause playback" });
  await expect(pause).toBeVisible();
  await body.click({ position: jumpPoint, modifiers: ["ControlOrMeta"] });
  await expect.poll(() => playheadX(page)).toBeLessThan(startX + 20);
  await expect(pause).toBeVisible();
  const afterSeek = await playheadX(page);
  await expect.poll(() => playheadX(page)).toBeGreaterThan(afterSeek + 2);
  await pause.click();
});

test("the clip menu's Jump to start moves the playhead to the clip start", async ({
  page,
}) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  // An empty layer to click in, apart from the clip's.
  await addLayers(page, 1);
  const clip = await addVideoClip(page, "ControlOrMeta");
  const otherLane = page
    .locator("[data-timeline-lane-id]")
    .filter({ hasNot: page.locator(".clip-card") })
    .first();
  const startX = await clipX(page, clip);
  await seekIntoClip(page, clip, otherLane);
  await expect.poll(() => playheadX(page)).toBeGreaterThan(startX + 40);

  await clip.locator(".clip-card__body").click({ button: "right" });
  const item = page.getByRole("menuitem", { name: /Jump to start/ });
  await expect(item).toContainText(/(Ctrl|Cmd)\+click/);
  await item.click();
  await expect(clip).toHaveClass(/clip-card--selected/);
  await expect.poll(() => distanceToClipStart(page, startX)).toBeLessThan(3);
});

test("on macOS Cmd-click jumps and Ctrl-click opens the clip menu", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "platform", {
      get: () => "MacIntel",
    });
    Object.defineProperty(Navigator.prototype, "userAgentData", {
      get: () => ({ platform: "macOS" }),
    });
  });
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  // An empty layer to click in, apart from the clip's.
  await addLayers(page, 1);
  const clip = await addVideoClip(page, "Meta");
  const otherLane = page
    .locator("[data-timeline-lane-id]")
    .filter({ hasNot: page.locator(".clip-card") })
    .first();
  const body = clip.locator(".clip-card__body");
  await expect(body).toHaveAttribute("title", "Cmd+click to jump to start");
  const startX = await clipX(page, clip);
  const bodyBox = await body.boundingBox();
  if (!bodyBox) {
    throw new Error("clip is not visible");
  }
  const x = bodyBox.x + bodyBox.width * 0.75;
  const y = bodyBox.y + bodyBox.height / 2;

  // Ctrl-click is a right-click that opens the menu.
  await seekIntoClip(page, clip, otherLane);
  await expect.poll(() => playheadX(page)).toBeGreaterThan(startX + 40);
  await page.keyboard.down("Control");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await body.dispatchEvent("contextmenu", {
    button: 0,
    ctrlKey: true,
    clientX: x,
    clientY: y,
  });
  await page.mouse.up();
  await page.keyboard.up("Control");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: /Jump to start/ }),
  ).toContainText("Cmd+click");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  // Cmd-click jumps.
  await body.click({
    position: { x: x - bodyBox.x, y: y - bodyBox.y },
    modifiers: ["Meta"],
  });
  await expect(clip).toHaveClass(/clip-card--selected/);
  await expect.poll(() => distanceToClipStart(page, startX)).toBeLessThan(3);
  await expect(page.locator(".clip-card")).toHaveCount(1);
});
