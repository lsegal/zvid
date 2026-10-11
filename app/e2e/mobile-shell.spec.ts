import { readFile } from "node:fs/promises";
import {
  type CDPSession,
  devices,
  expect,
  type Locator,
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

// Waits out a swipe's fling: touches during one can't stop the scroll.
async function settledPlayheadQ(page: Page) {
  let last = Number.NaN;
  await expect
    .poll(async () => {
      const previous = last;
      last = await playheadQ(page);
      return last === previous;
    })
    .toBe(true);
  return last;
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
    line: document.querySelector(".timeline-playhead")?.getBoundingClientRect()
      .left,
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

test("pinching zooms the timeline", async ({ page }) => {
  await page.goto("/");
  const client = await page.context().newCDPSession(page);
  await addClip(page);
  const before = (await page.locator(".clip-card").boundingBox())?.width ?? 0;
  const { x, y } = await centerOf(page, ".timeline-scroll");
  await touch(client, "touchStart", [
    { x: x - 30, y },
    { x: x + 30, y },
  ]);
  for (let step = 1; step <= 10; step += 1) {
    await touch(client, "touchMove", [
      { x: x - 30 - step * 6, y },
      { x: x + 30 + step * 6, y },
    ]);
  }
  await touch(client, "touchEnd", []);
  await expect
    .poll(async () => (await page.locator(".clip-card").boundingBox())?.width)
    .toBeGreaterThan(before * 1.5);
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
  const lane = await page.locator('[data-timeline-lane-id="1"]').boundingBox();
  await hold(
    page,
    client,
    {
      x: scroll.x * 2 - 8,
      y: (lane?.y ?? 0) + (lane?.height ?? 0) - 6,
    },
    50,
  );
  await expect(toolbar).toBeHidden();
});

test("Undo and Redo are one tap away in the top bar", async ({ page }) => {
  await page.goto("/");
  const client = await page.context().newCDPSession(page);
  const topBar = page.locator(".mobile-topbar");
  const undo = topBar.getByRole("button", { name: /^Undo/ });
  const redo = topBar.getByRole("button", { name: /^Redo/ });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  await addClip(page);
  await expect(undo).toBeEnabled();
  const scroll = await centerOf(page, ".timeline-scroll");
  const y = (await centerOf(page, ".clip-card")).y;
  await drag(page, client, { x: scroll.x + 60, y }, { x: scroll.x - 60, y });
  await expect.poll(() => playheadQ(page)).toBeGreaterThan(1);
  await page.locator(".clip-card__body").tap();
  await page
    .getByRole("toolbar", { name: "Clip actions" })
    .getByRole("button", { name: "Split at playhead" })
    .click();
  await expect(page.locator(".clip-card")).toHaveCount(2);
  // Named like the Edit menu's items.
  await expect(undo).toHaveAccessibleName("Undo Split clip");
  await undo.tap();
  await expect(page.locator(".clip-card")).toHaveCount(1);
  await expect(redo).toHaveAccessibleName("Redo Split clip");
  await redo.tap();
  await expect(page.locator(".clip-card")).toHaveCount(2);
  await expect(redo).toBeDisabled();
});

test("the More sheet has the desktop File and Edit menus", async ({ page }) => {
  await page.goto("/");
  const more = page.getByRole("button", { name: "More", exact: true });
  const sheet = page.locator(".mobile-menu-sheet");
  const items = sheet.locator(
    ".mobile-menu-sheet__item:not(.mobile-menu-sheet__back)",
  );
  await more.click();
  await expect(items).toHaveText([
    "File",
    "Edit",
    "Save to Library",
    "Reorder Layers",
    "Show Source Tracks",
  ]);
  await sheet.getByRole("menuitem", { name: "File" }).click();
  await expect(items).toHaveText([
    "New Session",
    "Open",
    "Import Media",
    "All Media Linked",
    "Media Storage…",
    "Session Settings…",
    "Connect to Share",
    "Save",
    "Export",
  ]);
  await sheet.getByRole("menuitem", { name: "Open" }).click();
  await expect(items).toHaveText(["Session…", "Sample"]);
  // Back to File.
  await sheet.locator(".mobile-menu-sheet__back").click();
  const chooser = page.waitForEvent("filechooser");
  await sheet.getByRole("menuitem", { name: "Import Media" }).click();
  await chooser;
  await expect(sheet).toBeHidden();
  await more.click();
  await sheet.getByRole("menuitem", { name: "File" }).click();
  await sheet.getByRole("menuitem", { name: "Session Settings…" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  await addClip(page);
  await more.click();
  await sheet.getByRole("menuitem", { name: "Edit" }).click();
  await expect(items.first()).toHaveText(/^Undo /);
  await items.first().click();
  await expect(page.locator(".clip-card")).toHaveCount(0);
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
  await expect(
    sheet.getByRole("menuitem", { name: "Duplicate" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close menu" }).click();
  await expect(sheet).toBeHidden();

  const before = await page.locator(".clip-card").boundingBox();
  await drag(page, client, clip, { x: clip.x + 80, y: clip.y }, 600);
  await expect
    .poll(async () => (await page.locator(".clip-card").boundingBox())?.x)
    .toBeGreaterThan((before?.x ?? 0) + 40);
});

// #1179: a swipe on empty lane space scrolls, so a hold starts a selection.
test("a long press and drag on empty lane space selects a range", async ({
  page,
}) => {
  await page.goto("/");
  const client = await page.context().newCDPSession(page);
  const scroll = await centerOf(page, ".timeline-scroll");
  const laneBox = await page
    .locator('[data-timeline-lane-id="1"]')
    .boundingBox();
  const y = (laneBox?.y ?? 0) + (laneBox?.height ?? 0) / 2;
  const selection = page.locator(".timeline-selection");
  const toolbar = page.getByRole("toolbar", { name: "Selection actions" });

  // A plain swipe still scrubs and draws nothing.
  await drag(page, client, { x: scroll.x + 60, y }, { x: scroll.x - 60, y });
  await expect.poll(() => playheadQ(page)).toBeGreaterThan(1);
  await expect(selection).toHaveCount(0);

  const before = await settledPlayheadQ(page);
  await drag(page, client, { x: scroll.x, y }, { x: scroll.x + 120, y }, 600);
  await expect(selection).toBeVisible();
  await expect(toolbar).toBeVisible();
  // The hold drew instead of scrolling, so the playhead stayed put.
  expect(await playheadQ(page)).toBe(before);
  const drawn = await selection.boundingBox();
  expect(drawn?.width ?? 0).toBeGreaterThan(80);

  // The end handle has a 44px target and stretches the selection.
  const end = await page
    .getByRole("button", { name: "Resize selection end" })
    .boundingBox();
  expect(end?.width).toBe(44);
  const endAt = {
    x: (end?.x ?? 0) + (end?.width ?? 0) / 2,
    y: (end?.y ?? 0) + (end?.height ?? 0) / 2,
  };
  await drag(page, client, endAt, { x: endAt.x + 60, y: endAt.y });
  await expect
    .poll(async () => (await selection.boundingBox())?.width ?? 0)
    .toBeGreaterThan((drawn?.width ?? 0) + 30);

  // A swipe keeps it; a tap on it opens its menu as a sheet.
  await drag(page, client, { x: scroll.x - 40, y }, { x: scroll.x + 40, y });
  await settledPlayheadQ(page);
  await expect(selection).toBeVisible();
  await expect(
    toolbar.getByRole("button", { name: "Insert Fill Clip" }),
  ).toBeEnabled();
  await selection.tap();
  const sheet = page.getByRole("menu", { name: "Selection actions" });
  await expect(sheet).toBeVisible();
  await expect(
    sheet.getByRole("menuitem", { name: "Insert Track" }),
  ).toBeVisible();
  await sheet.getByRole("menuitem", { name: "Insert Fill Clip" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator(".clip-card")).toHaveCount(1);
});

test("tapping elsewhere clears a lane selection", async ({ page }) => {
  await page.goto("/");
  const client = await page.context().newCDPSession(page);
  const scroll = await centerOf(page, ".timeline-scroll");
  const laneBox = await page
    .locator('[data-timeline-lane-id="1"]')
    .boundingBox();
  const y = (laneBox?.y ?? 0) + (laneBox?.height ?? 0) / 2;
  await drag(page, client, { x: scroll.x, y }, { x: scroll.x + 80, y }, 600);
  await expect(page.locator(".timeline-selection")).toBeVisible();
  await hold(page, client, { x: scroll.x + 150, y }, 50);
  await expect(page.locator(".timeline-selection")).toHaveCount(0);
  await expect(
    page.getByRole("toolbar", { name: "Selection actions" }),
  ).toBeHidden();
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

// #1172: the FX sheet's header is a drag handle, and no drag in the app
// starts the browser's pull-to-refresh.
test("dragging the FX sheet's header moves it between heights", async ({
  page,
}) => {
  await page.goto("/");
  for (const element of ["html", "body"]) {
    await expect(page.locator(element)).toHaveCSS(
      "overscroll-behavior-y",
      "none",
    );
  }
  const client = await page.context().newCDPSession(page);
  const tabs = page.getByRole("navigation", { name: "Editor" });
  await tabs.getByRole("button", { name: "FX" }).click();
  const fx = page.locator(".fx-panel");
  await expect(fx).toBeVisible();
  const half = (await fx.boundingBox())?.height ?? 0;
  const height = async () => (await fx.boundingBox())?.height ?? 0;

  const grabber = await centerOf(page, ".mobile-sheet-header__grabber");
  await drag(page, client, grabber, { x: grabber.x, y: grabber.y - 150 });
  await expect.poll(height).toBeGreaterThan(half * 1.5);
  await expect(page.getByRole("button", { name: "Half height" })).toBeVisible();

  const title = await centerOf(page, ".mobile-sheet-header__title");
  await drag(page, client, title, { x: title.x, y: title.y + 150 });
  await expect.poll(height).toBeCloseTo(half, 0);

  // Tapping the grabber still toggles the height.
  await page.locator(".mobile-sheet-header__grabber").click();
  await expect.poll(height).toBeGreaterThan(half * 1.5);
  await page.locator(".mobile-sheet-header__grabber").click();
  await expect.poll(height).toBeCloseTo(half, 0);

  const halfGrabber = await centerOf(page, ".mobile-sheet-header__grabber");
  await drag(page, client, halfGrabber, {
    x: halfGrabber.x,
    y: halfGrabber.y + 150,
  });
  await expect(fx).toBeHidden();
});

test("the top bar's Export opens the export flow, or explains the desktop app", async ({
  page,
}) => {
  await page.goto("/");
  await addClip(page);
  const exportButton = page
    .locator(".mobile-topbar")
    .getByRole("button", { name: /^Export/ });
  await expect(exportButton).toHaveText("Export");
  await expect(exportButton).toBeEnabled({ timeout: 15_000 });
  const support = await exportButton.getAttribute("data-export-support");
  await exportButton.click();
  await expect(
    page.getByRole("heading", {
      name:
        support === "supported" ? "Export" : "Download the zvid desktop app",
      exact: true,
    }),
  ).toBeVisible();
});

test("dragging a menu sheet's grabber down closes it", async ({ page }) => {
  await page.goto("/");
  const client = await page.context().newCDPSession(page);
  await page.getByRole("button", { name: "More", exact: true }).click();
  const sheet = page.locator(".mobile-menu-sheet");
  await expect(sheet).toBeVisible();
  const handle = await centerOf(page, ".mobile-sheet__handle");
  await drag(page, client, handle, { x: handle.x, y: handle.y + 20 });
  await expect(sheet).toBeVisible();
  await drag(page, client, handle, { x: handle.x, y: handle.y + 120 });
  await expect(sheet).toBeHidden();
});

// Menus portal to <body>, outside the sheets (#1170). An open menu blocks
// pointer events everywhere else, so a hit test can't see a sheet drawn over
// it; compare stacking instead. The sheet layer (.mobile-sheet-layer) sits
// at 90, above the FX sheet.
async function expectAboveSheets(page: Page, list: Locator) {
  const viewport = page.viewportSize();
  const box = await list.boundingBox();
  // A pixel of slack for subpixel layout at the screen's edge.
  expect(box?.x).toBeGreaterThanOrEqual(-1);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
    (viewport?.width ?? 0) + 1,
  );
  const [layer, sheet] = await list.evaluate((element) => {
    const zIndex = (node: Element | null) =>
      node ? Number(getComputedStyle(node).zIndex) || 0 : 0;
    return [
      zIndex(element.closest("[data-radix-popper-content-wrapper]")),
      zIndex(document.querySelector(".fx-panel")),
    ];
  });
  expect(layer).toBeGreaterThan(Math.max(sheet, 90));
}

test("menus and selects in the FX sheet open above it", async ({ page }) => {
  await page.goto("/");
  const tabs = page.getByRole("navigation", { name: "Editor" });
  await tabs.getByRole("button", { name: "FX" }).click();
  const fx = page.locator(".fx-panel");
  await expect(fx).toBeVisible();

  await fx.getByRole("button", { name: "Add device to Global" }).click();
  const menu = page.getByRole("menu").first();
  await expect(menu).toBeVisible();
  await expectAboveSheets(page, menu);
  await menu.getByRole("menuitem", { name: "Transform" }).click();
  const submenu = page.getByRole("menu").nth(1);
  await expect(submenu).toBeVisible();
  await expectAboveSheets(page, submenu);
  await submenu.getByRole("menuitem", { name: /^Zoom & Pan/ }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);

  await fx.getByRole("button", { name: "Animation", exact: true }).click();
  await fx.getByRole("combobox", { name: "Motion In" }).click();
  const options = page.getByRole("listbox");
  await expect(options).toBeVisible();
  await expectAboveSheets(page, options);
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
  });

  // Toolbar controls keep their desktop size and take a 44px-tall touch
  // through an invisible hit area that no neighbor's covers (#1186).
  test("keeps desktop-sized controls with 44px touch targets", async ({
    browser,
    page,
  }) => {
    // A mouse on the same window size; touch must be off explicitly.
    const desktop = await browser.newContext({
      viewport: { width: 820, height: 1180 },
      hasTouch: false,
      isMobile: false,
    });
    const desktopPage = await desktop.newPage();
    const desktopSizes = await controlSizes(desktopPage);
    await desktop.close();
    const sizes = await controlSizes(page);
    expect(Object.keys(sizes)).toEqual(
      expect.arrayContaining([
        "Record",
        "Snap On",
        "Tempo",
        "Timeline",
        "Zoom in",
      ]),
    );
    expect(sizes).toEqual(desktopSizes);

    const hits = await page.locator(TOUCH_CONTROLS).evaluateAll((controls) =>
      controls
        .filter((control) => control.getClientRects().length > 0)
        .map((control) => {
          const box = control.getBoundingClientRect();
          const x = box.x + box.width / 2;
          const y = box.y + box.height / 2;
          const hit = (dy: number) =>
            document.elementFromPoint(x, y + dy)?.closest("button") === control;
          return {
            name: control.getAttribute("aria-label") ?? control.textContent,
            center: hit(0),
            touch: hit(-21) && hit(21),
          };
        }),
    );
    expect(hits.length).toBeGreaterThan(5);
    for (const hit of hits) {
      expect(hit, String(hit.name)).toEqual({
        ...hit,
        center: true,
        touch: true,
      });
    }

    // Every other button still takes a tap at its own center.
    const stolen = await page.locator("button:visible").evaluateAll((buttons) =>
      buttons
        .filter((button) => {
          const box = button.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) return false;
          const hit = document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          );
          return (
            hit !== null &&
            !button.contains(hit) &&
            hit.closest("button") !== null
          );
        })
        .map(
          (button) => button.getAttribute("aria-label") ?? button.textContent,
        ),
    );
    expect(stolen).toEqual([]);
  });
});

// The Sessions/Media/Record, Tempo/Time and Snap switches, the preview
// tabs, the menubar and the zoom buttons.
const TOUCH_CONTROLS = [
  ".timeline-toolbar .segmented-control button",
  ".preview-panel__tabs button",
  ".menubar-item",
  ".zoom-control__button",
].join(", ");

async function controlSizes(page: Page) {
  await page.goto("/");
  await expect(page.locator(".topbar")).toBeVisible();
  const sizes = await page.locator(TOUCH_CONTROLS).evaluateAll((controls) =>
    controls
      .filter((control) => control.getClientRects().length > 0)
      .map((control) => {
        const { width, height } = control.getBoundingClientRect();
        const name = control.getAttribute("aria-label") ?? control.textContent;
        return [String(name), { width, height }] as const;
      }),
  );
  return Object.fromEntries(sizes);
}

test.describe("narrow window with a mouse", () => {
  test.use({ hasTouch: false, isMobile: false });

  test("keeps the desktop layout", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".topbar")).toBeVisible();
    await expect(page.locator(".mobile-tab-bar")).toHaveCount(0);
  });
});
