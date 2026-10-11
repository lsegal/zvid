import { readFile } from "node:fs/promises";
import {
  type CDPSession,
  devices,
  expect,
  type Page,
  test,
} from "@playwright/test";

// The touch-first phone shell (#1168): a phone-sized touch viewport gets
// the mobile layout, while fine pointers and tablets keep the desktop one.
// Touches go through CDP so swipes scroll natively, as on a phone. A
// four-second test pattern at 120 BPM spans eight quarters.
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);
const { defaultBrowserType: _, ...PHONE } = devices["Pixel 7"];

test.use(PHONE);

type Point = { x: number; y: number };

type TouchType = "touchStart" | "touchMove" | "touchEnd";

async function touch(client: CDPSession, type: TouchType, points: Point[]) {
  await client.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: points.map((point, id) => ({ ...point, id })),
  });
}

// A finger from `from` to `to` in steps, after holding still for `holdMs`.
async function drag(
  page: Page,
  client: CDPSession,
  from: Point,
  to: Point,
  holdMs = 0,
) {
  await touch(client, "touchStart", [from]);
  if (holdMs) {
    await page.waitForTimeout(holdMs);
  }
  const steps = 12;
  for (let step = 1; step <= steps; step += 1) {
    await touch(client, "touchMove", [
      {
        x: from.x + ((to.x - from.x) * step) / steps,
        y: from.y + ((to.y - from.y) * step) / steps,
      },
    ]);
    await page.waitForTimeout(16);
  }
  await touch(client, "touchEnd", []);
}

async function hold(page: Page, client: CDPSession, at: Point, ms = 700) {
  await touch(client, "touchStart", [at]);
  await page.waitForTimeout(ms);
  await touch(client, "touchEnd", []);
}

async function centerOf(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) {
    throw new Error(`${selector} is not visible`);
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function playheadQ(page: Page) {
  const text = await page.locator(".mobile-transport__position").innerText();
  const [bar, beat, sixteenth] = text.split(".").map(Number);
  return (bar - 1) * 4 + (beat - 1) + (sixteenth - 1) / 4;
}

// Puts the test pattern on Layer 1 through the phone's own menus: show the
// source tracks, drop the file, then Copy to layer from the clip's menu
// sheet.
async function addClip(page: Page) {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Show Source Tracks" }).click();
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
  await page.locator(".source-span").dispatchEvent("contextmenu");
  await page.getByRole("menuitem", { name: "Copy to layer" }).click();
  await page.getByRole("menuitem", { name: /Layer 1/ }).click();
  await expect(page.locator(".clip-card")).toHaveCount(1);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Hide Source Tracks" }).click();
  await expect(page.locator(".source-span")).toBeHidden();
}

test("a phone gets the mobile shell with no page scroll", async ({ page }) => {
  await page.goto("/");
  const shell = page.locator(".app-shell");
  await expect(shell).toHaveClass(/app-shell--phone/);
  await expect(page.locator(".topbar")).toBeHidden();
  await expect(page.locator(".mobile-topbar")).toBeVisible();
  await expect(page.locator(".mobile-transport")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Editor" })).toBeVisible();
  const layout = await page.evaluate(() => {
    const box = (selector: string) =>
      document.querySelector(selector)?.getBoundingClientRect();
    return {
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      preview: box(".preview-monitor"),
      transport: box(".mobile-transport"),
      timeline: box(".timeline-panel"),
      tabs: box(".mobile-tab-bar"),
    };
  });
  expect(layout.scrollHeight).toBeLessThanOrEqual(layout.innerHeight);
  // Preview first, then the transport, the timeline and the tabs.
  expect(layout.preview?.bottom).toBeLessThanOrEqual(
    layout.transport?.top ?? 0,
  );
  expect(layout.transport?.bottom).toBeLessThanOrEqual(
    layout.timeline?.top ?? 0,
  );
  expect(layout.timeline?.bottom).toBeLessThanOrEqual(layout.tabs?.top ?? 0);
});

test("the playhead stays centered while a swipe scrubs", async ({ page }) => {
  await page.goto("/");
  const client = await page.context().newCDPSession(page);
  await addClip(page);
  const scroll = await centerOf(page, ".timeline-scroll");
  const clipBefore = await page.locator(".clip-card").boundingBox();
  const y = (await centerOf(page, ".clip-card")).y;
  // Starting on the clip, which a swipe scrolls past instead of moving.
  await drag(page, client, { x: scroll.x + 100, y }, { x: scroll.x - 60, y });
  await expect.poll(() => playheadQ(page)).toBeGreaterThan(1);
  const { line, view } = await page.evaluate(() => ({
    line: document
      .querySelector(".timeline-playhead")
      ?.getBoundingClientRect().left,
    view: document.querySelector(".timeline-scroll")?.getBoundingClientRect(),
  }));
  expect(
    Math.abs((line ?? 0) - ((view?.left ?? 0) + (view?.width ?? 0) / 2)),
  ).toBeLessThan(4);
  // The clip scrolled with the timeline, and kept its time.
  const clipAfter = await page.locator(".clip-card").boundingBox();
  const scrolled = await page
    .locator(".timeline-scroll")
    .evaluate((element) => element.scrollLeft);
  expect(
    Math.abs((clipAfter?.x ?? 0) + scrolled - (clipBefore?.x ?? 0)),
  ).toBeLessThan(2);
});

test("a tap shows the selection toolbar and Split cuts at the center", async ({
  page,
}) => {
  await page.goto("/");
  const client = await page.context().newCDPSession(page);
  await addClip(page);
  const scroll = await centerOf(page, ".timeline-scroll");
  const y = (await centerOf(page, ".clip-card")).y;
  await drag(page, client, { x: scroll.x + 60, y }, { x: scroll.x - 60, y });
  await expect.poll(() => playheadQ(page)).toBeGreaterThan(1);
  await page.locator(".clip-card__body").tap();
  const toolbar = page.getByRole("toolbar", { name: "Clip actions" });
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", { name: "Split at playhead" }).click();
  await expect(page.locator(".clip-card")).toHaveCount(2);
  // Tapping empty space drops the selection and the toolbar.
  const lane = await page
    .locator('[data-timeline-lane-id="1"]')
    .boundingBox();
  await hold(page, client, {
    x: scroll.x * 2 - 8,
    y: (lane?.y ?? 0) + (lane?.height ?? 0) - 6,
  }, 50);
  await expect(toolbar).toBeHidden();
});

test("a long press opens the clip menu as a sheet; hold and drag moves", async ({
  page,
}) => {
  await page.goto("/");
  const client = await page.context().newCDPSession(page);
  await addClip(page);
  const clip = await centerOf(page, ".clip-card");
  await hold(page, client, clip);
  const sheet = page.getByRole("menu", { name: "Clip actions" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("menuitem", { name: "Duplicate" })).toBeVisible();
  await page.getByRole("button", { name: "Close menu" }).click();
  await expect(sheet).toBeHidden();

  const before = await page.locator(".clip-card").boundingBox();
  await drag(page, client, clip, { x: clip.x + 80, y: clip.y }, 600);
  await expect
    .poll(async () => (await page.locator(".clip-card").boundingBox())?.x)
    .toBeGreaterThan((before?.x ?? 0) + 40);
});

test("FX opens as a half or full sheet and Media as a full screen", async ({
  page,
}) => {
  await page.goto("/");
  const tabs = page.getByRole("navigation", { name: "Editor" });
  await tabs.getByRole("button", { name: "FX" }).click();
  const fx = page.locator(".fx-panel");
  await expect(fx).toBeVisible();
  const half = (await fx.boundingBox())?.height ?? 0;
  await page.getByRole("button", { name: "Full height" }).click();
  await expect
    .poll(async () => (await fx.boundingBox())?.height ?? 0)
    .toBeGreaterThan(half * 1.5);
  await page.getByRole("button", { name: "Animation", exact: true }).click();
  await page.getByRole("button", { name: "Close FX" }).click();
  await expect(fx).toBeHidden();

  await tabs.getByRole("button", { name: "Media" }).click();
  await expect(page.getByRole("button", { name: "Camera roll" })).toBeVisible();
  const drawer = await page.locator(".media-drawer").boundingBox();
  const viewport = page.viewportSize();
  expect(drawer?.width).toBe(viewport?.width);
  await page.getByRole("button", { name: "Close media" }).click();
  await expect(page.getByRole("button", { name: "Camera roll" })).toBeHidden();
});

test.describe("landscape phone", () => {
  test.use({ viewport: { width: 915, height: 412 } });

  test("puts the preview left of the timeline", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app-shell")).toHaveClass(
      /app-shell--phone-landscape/,
    );
    const preview = await page.locator(".preview-monitor").boundingBox();
    const timeline = await page.locator(".timeline-panel").boundingBox();
    expect((preview?.x ?? 0) + (preview?.width ?? 0)).toBeLessThanOrEqual(
      timeline?.x ?? 0,
    );
    await expect(page.locator(".fx-panel")).toBeHidden();
  });
});

test.describe("tablet", () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test("keeps the desktop layout with a coarse pointer", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".topbar")).toBeVisible();
    await expect(page.locator(".app-shell")).not.toHaveClass(
      /app-shell--phone/,
    );
    const zoomButton = await page
      .getByRole("button", { name: "Zoom in" })
      .boundingBox();
    expect(zoomButton?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});

test.describe("narrow window with a mouse", () => {
  test.use({ hasTouch: false, isMobile: false });

  test("keeps the desktop layout", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".topbar")).toBeVisible();
    await expect(page.locator(".mobile-tab-bar")).toHaveCount(0);
  });
});
