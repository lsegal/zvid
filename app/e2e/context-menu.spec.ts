import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// Right-click menus on the editor's clips, lanes and source clips, driven in
// the real app. A four-second test pattern at 120 BPM spans eight quarters.
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

// Scrolling closes an open menu, so bring the target into view (and let its
// scroll event fire) before right-clicking it.
async function rightClick(
  locator: Locator,
  position?: { x: number; y: number },
) {
  await locator.scrollIntoViewIfNeeded();
  await locator
    .page()
    .evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  await locator.click({ button: "right", position });
}

function menuItem(page: Page, name: string) {
  return page.getByRole("menuitem", { name });
}

// Default layers: "1" is Layer 1, "5" is Layer 2 and "6" is Layer 3.
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
});

test("right-clicking empty lane space selects the layer and offers only Paste", async ({
  page,
}) => {
  await rightClick(lane(page, "5"), { x: 400, y: 20 });

  const menu = page.getByRole("menu", { name: "Layer actions" });
  await expect(menu).toBeVisible();
  await expect(page.locator(".fx-panel__toggle")).toHaveText("Layer 2 effects");
  await expect(menu.getByRole("menuitem")).toHaveCount(6);
  // Nothing is on the clipboard yet, so even Paste is disabled.
  for (const item of await menu.getByRole("menuitem").all()) {
    await expect(item).toHaveAttribute("aria-disabled", "true");
  }

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  await rightClick(lane(page, "6"), { x: 400, y: 20 });
  await expect(menu).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(menu).toBeHidden();

  // With nothing focused, Shift+F10 and the context-menu key open it on the
  // selected layer.
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur(),
  );
  await page.keyboard.press("Shift+F10");
  await expect(menu).toBeVisible();
  await expect(page.locator(".fx-panel__toggle")).toHaveText("Layer 3 effects");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await page.keyboard.press("ContextMenu");
  await expect(menu).toBeVisible();
});

test("source clip menu copies to a chosen layer, and clip menu pastes at the playhead on the selected layer", async ({
  page,
}) => {
  await dropVideoIntoNewSourceTrack(page);

  // Copy to layer ▸ Layer 1 through the keyboard: → opens the submenu.
  await rightClick(page.locator(".source-span"));
  const spanMenu = page.getByRole("menu", { name: "Source clip actions" });
  await expect(spanMenu).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(menuItem(page, "Copy to layer")).toHaveAttribute(
    "data-highlighted",
    "",
  );
  await page.keyboard.press("ArrowRight");
  const submenu = page.getByRole("menu", { name: "Copy to layer" });
  await expect(submenu).toBeVisible();
  await expect(submenu.getByRole("menuitem")).toHaveText([
    "Auto (last free layer)",
    "Layer 1",
    "Layer 2",
    "Layer 3",
    "New layer",
  ]);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(spanMenu).toBeHidden();
  await expect(lane(page, "1").locator(".clip-card")).toHaveCount(1);

  // A specific layer overrides Auto: Layer 1 again, even though it overlaps.
  await rightClick(page.locator(".source-span"));
  await menuItem(page, "Copy to layer").hover();
  await menuItem(page, "Layer 1").click();
  await expect(lane(page, "1").locator(".clip-card")).toHaveCount(1);
  await expect(page.locator(".clip-card")).toHaveCount(1);

  // Auto takes the last free layer, as Ctrl/Cmd-click does.
  await rightClick(page.locator(".source-span"));
  await menuItem(page, "Copy to layer").hover();
  await menuItem(page, "Auto (last free layer)").click();
  await expect(lane(page, "6").locator(".clip-card")).toHaveCount(1);

  // Right-clicking a clip selects it; Copy, then Paste on another layer.
  const clip = lane(page, "1").locator(".clip-card");
  await rightClick(clip);
  const clipMenu = page.getByRole("menu", { name: "Clip actions" });
  await expect(clipMenu).toBeVisible();
  await expect(clip).toHaveClass(/clip-card--selected/);
  await expect(menuItem(page, "Split at playhead")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await menuItem(page, "Copy").click();
  await expect(clipMenu).toBeHidden();

  await rightClick(lane(page, "5"), { x: 400, y: 20 });
  await expect(menuItem(page, "Paste")).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await menuItem(page, "Paste").click();
  const pasted = lane(page, "5").locator(".clip-card");
  await expect(pasted).toHaveCount(1);
  await expect(pasted).toHaveClass(/clip-card--selected/);
  // The playhead sits at the start, so the paste lands there too.
  await expect(pasted).toHaveCSS("left", "0px");

  // Shift+F10 opens the menu on the selected clip; End reaches Delete.
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur(),
  );
  await page.keyboard.press("Shift+F10");
  await expect(clipMenu).toBeVisible();
  await page.keyboard.press("End");
  await expect(menuItem(page, "Delete")).toHaveAttribute(
    "data-highlighted",
    "",
  );
  await page.keyboard.press("Enter");
  await expect(clipMenu).toBeHidden();
  await expect(lane(page, "5").locator(".clip-card")).toHaveCount(0);
});

test("the FX device menu runs on the shared context menu", async ({ page }) => {
  await rightClick(lane(page, "1"), { x: 400, y: 20 });
  await page.keyboard.press("Escape");

  const title = page.locator("[data-fx-focus]").first();
  await rightClick(title);
  const menu = page.getByRole("menu", { name: /actions$/ });
  await expect(menu).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(menuItem(page, "Collapse")).toHaveAttribute(
    "data-highlighted",
    "",
  );
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  await rightClick(title);
  await expect(menuItem(page, "Expand")).toBeVisible();
});

// Whether the browser would show its own menu for the last contextmenu event.
// Handlers stop it from bubbling, so keep the event from the capture phase and
// read it once they have all run.
async function trackNativeMenu(page: Page) {
  await page.evaluate(() => {
    const state = window as unknown as { __lastContextMenu?: Event };
    window.addEventListener(
      "contextmenu",
      (event) => {
        state.__lastContextMenu = event;
      },
      true,
    );
  });
}

function lastEventShowedNativeMenu(page: Page) {
  return page.evaluate(() => {
    const event = (window as unknown as { __lastContextMenu?: Event })
      .__lastContextMenu;
    return event ? !event.defaultPrevented : undefined;
  });
}

// Dispatches contextmenu on the first match of `selector` itself, as when the
// press starts on that element, and reports whether the native menu would
// have opened.
function contextMenuOn(page: Page, selector: string) {
  return page.evaluate((target) => {
    const element = document.querySelector(target);
    if (!element) {
      throw new Error(`No element matches ${target}`);
    }

    const bounds = element.getBoundingClientRect();
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + bounds.height / 2,
    });
    element.dispatchEvent(event);
    return !event.defaultPrevented;
  }, selector);
}

test("right-clicks on clips, lanes and source clips, even on their thumbnails, never open the browser menu", async ({
  page,
}) => {
  await dropVideoIntoNewSourceTrack(page);
  await page.locator(".source-span").click({ modifiers: ["ControlOrMeta"] });
  const clip = lane(page, "6").locator(".clip-card");
  await expect(clip).toHaveCount(1);
  await expect(page.locator(".clip-card__tile").first()).toBeAttached();
  await expect(page.locator(".source-span__tile").first()).toBeAttached();
  await trackNativeMenu(page);

  const clipMenu = page.getByRole("menu", { name: "Clip actions" });
  const laneMenu = page.getByRole("menu", { name: "Layer actions" });
  const spanMenu = page.getByRole("menu", { name: "Source clip actions" });

  // Real right-clicks.
  for (const [target, menu] of [
    [clip, clipMenu],
    [page.locator(".source-span"), spanMenu],
  ] as const) {
    await rightClick(target);
    await expect(menu).toBeVisible();
    expect(await lastEventShowedNativeMenu(page)).toBe(false);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  }
  await rightClick(lane(page, "5"), { x: 400, y: 20 });
  await expect(laneMenu).toBeVisible();
  expect(await lastEventShowedNativeMenu(page)).toBe(false);
  await page.keyboard.press("Escape");

  // Presses that start on a clip's children, including images and video,
  // where browsers otherwise offer their image and video menus.
  await page.evaluate(() => {
    for (const parent of document.querySelectorAll(
      ".clip-card, .source-span",
    )) {
      const image = document.createElement("img");
      image.className = "test-image";
      const video = document.createElement("video");
      video.className = "test-video";
      parent.append(image, video);
    }
  });
  for (const [owner, menu] of [
    [".clip-card", clipMenu],
    [".source-span", spanMenu],
  ] as const) {
    const prefix = owner.slice(1);
    for (const child of [
      `.${prefix}__filmstrip`,
      `.${prefix}__tile`,
      `.${prefix}__body`,
      `${owner} .test-image`,
      `${owner} .test-video`,
    ]) {
      if (!(await page.locator(child).count())) {
        continue;
      }
      expect(await contextMenuOn(page, child), child).toBe(false);
      await expect(menu).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
    }
  }
  // Every clip has at least its filmstrip, body, image and video checked.
  await expect(page.locator(".clip-card__filmstrip")).toHaveCount(1);
  await expect(page.locator(".source-span__filmstrip")).toHaveCount(1);

  // Elsewhere the browser keeps its own menu.
  expect(await contextMenuOn(page, ".topbar")).toBe(true);
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("Ctrl-click on macOS opens the menus without selecting, dragging or dropping", async ({
  page,
}) => {
  // Report macOS so the editor treats Ctrl-click as a context-menu press.
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "platform", {
      get: () => "MacIntel",
    });
    Object.defineProperty(Navigator.prototype, "userAgentData", {
      get: () => ({ platform: "macOS" }),
    });
  });
  await page.reload();
  await expect(lane(page, "1")).toBeVisible();
  await dropVideoIntoNewSourceTrack(page);
  await page.locator(".source-span").click({ modifiers: ["Meta"] });
  await expect(page.locator(".clip-card")).toHaveCount(1);
  await trackNativeMenu(page);

  // macOS sends a primary-button press with Ctrl, then contextmenu.
  async function ctrlClick(
    target: Locator,
    position = { x: 20, y: 20 },
  ): Promise<void> {
    await target.scrollIntoViewIfNeeded();
    const bounds = await target.boundingBox();
    if (!bounds) {
      throw new Error("Target is not visible");
    }
    const x = bounds.x + position.x;
    const y = bounds.y + position.y;
    await page.keyboard.down("Control");
    await page.mouse.move(x, y);
    await page.mouse.down();
    await target.dispatchEvent("contextmenu", {
      button: 0,
      ctrlKey: true,
      clientX: x,
      clientY: y,
    });
    await page.mouse.up();
    await page.keyboard.up("Control");
  }

  await ctrlClick(lane(page, "5"), { x: 400, y: 20 });
  await expect(page.getByRole("menu", { name: "Layer actions" })).toBeVisible();
  expect(await lastEventShowedNativeMenu(page)).toBe(false);
  await expect(page.locator(".timeline-selection")).toHaveCount(0);
  await page.keyboard.press("Escape");

  const clip = page.locator(".clip-card");
  // The lane press scrolled the timeline, leaving the clip under the sticky
  // layer labels, so scroll back before pressing it.
  await page.locator(".timeline-scroll").evaluate((element) => {
    element.scrollLeft = 0;
  });
  await ctrlClick(clip.locator(".clip-card__body"));
  await expect(page.getByRole("menu", { name: "Clip actions" })).toBeVisible();
  expect(await lastEventShowedNativeMenu(page)).toBe(false);
  await expect(clip).toHaveCount(1);
  await expect(clip).toHaveClass(/clip-card--selected/);
  await page.keyboard.press("Escape");

  // Cmd-click drops a source clip on macOS; Ctrl-click only opens its menu.
  await ctrlClick(page.locator(".source-span"));
  await expect(
    page.getByRole("menu", { name: "Source clip actions" }),
  ).toBeVisible();
  expect(await lastEventShowedNativeMenu(page)).toBe(false);
  await expect(page.locator(".clip-card")).toHaveCount(1);
});

// Drags out an uncommitted selection on `target` between two x offsets from
// the song start, with the timeline scrolled back to it.
async function dragSelection(target: Locator, fromX: number, toX: number) {
  const page = target.page();
  await target.scrollIntoViewIfNeeded();
  await page.locator(".timeline-scroll").evaluate(
    (element) =>
      new Promise((resolve) => {
        element.scrollLeft = 0;
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );
  const bounds = await target.boundingBox();
  if (!bounds) {
    throw new Error("Target is not visible");
  }
  const y = bounds.y + 20;
  await page.mouse.move(bounds.x + fromX, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + toX, y, { steps: 4 });
  await page.mouse.up();
  await expect(target.locator(".timeline-selection")).toBeVisible();
}

// Right-clicks the lane `x` from the song start where `dragSelection` left
// it, without scrolling, which would close the menu.
async function rightClickLaneAt(target: Locator, x: number) {
  const bounds = await target.boundingBox();
  if (!bounds) {
    throw new Error("Target is not visible");
  }
  await target.page().mouse.click(bounds.x + x, bounds.y + 20, {
    button: "right",
  });
}

test("right-clicking a selection keeps it and inserts a track like its number key", async ({
  page,
}) => {
  await dropVideoIntoNewSourceTrack(page);
  const trackName = "test-pattern";

  // The number key commits the same range on Layer 2, for comparison.
  await dragSelection(lane(page, "5"), 30, 130);
  await page.keyboard.press("1");
  const keyed = lane(page, "5").locator(".clip-card");
  await expect(keyed).toHaveCount(1);

  await dragSelection(lane(page, "1"), 30, 130);
  const selection = lane(page, "1").locator(".timeline-selection");
  const selectionBox = await selection.boundingBox();
  await rightClickLaneAt(lane(page, "1"), 80);
  const menu = page.getByRole("menu", { name: "Selection actions" });
  await expect(menu).toBeVisible();
  await expect(selection).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText([
    /^Cut/,
    /^Copy/,
    /^Delete/,
    "Insert Track",
    "Insert Fill Layer",
    "Clear selectionEsc",
  ]);

  await menuItem(page, "Insert Track").hover();
  const submenu = page.getByRole("menu", { name: "Insert Track" });
  await expect(submenu).toBeVisible();
  await expect(submenu.getByRole("menuitem")).toHaveText([`${trackName}1`]);
  await submenu.getByRole("menuitem", { name: trackName }).click();
  await expect(menu).toBeHidden();
  await expect(page.locator(".timeline-selection")).toHaveCount(0);

  const inserted = lane(page, "1").locator(".clip-card");
  await expect(inserted).toHaveCount(1);
  await expect(inserted).toHaveClass(/clip-card--selected/);
  const insertedBox = await inserted.boundingBox();
  const keyedBox = await keyed.boundingBox();
  expect(insertedBox?.x).toBeCloseTo(keyedBox?.x ?? Number.NaN, 0);
  expect(insertedBox?.width).toBeCloseTo(keyedBox?.width ?? Number.NaN, 0);
  expect(insertedBox?.x).toBeCloseTo(selectionBox?.x ?? Number.NaN, 0);

  // Insert Fill Layer fills exactly the selected range and selects the fill.
  await dragSelection(lane(page, "6"), 30, 130);
  const fillSelection = lane(page, "6").locator(".timeline-selection");
  const fillSelectionBox = await fillSelection.boundingBox();
  await rightClickLaneAt(lane(page, "6"), 80);
  await menuItem(page, "Insert Fill Layer").click();
  await expect(menu).toBeHidden();
  await expect(page.locator(".timeline-selection")).toHaveCount(0);
  const fill = lane(page, "6").locator(".clip-card--fill");
  await expect(fill).toHaveCount(1);
  await expect(fill).toHaveClass(/clip-card--selected/);
  const fillBox = await fill.boundingBox();
  expect(fillBox?.x).toBeCloseTo(fillSelectionBox?.x ?? Number.NaN, 0);
  expect(fillBox?.width).toBeCloseTo(fillSelectionBox?.width ?? Number.NaN, 0);

  // Past the end of the footage, the track is disabled.
  await dragSelection(lane(page, "6"), 600, 700);
  await rightClickLaneAt(lane(page, "6"), 650);
  await menuItem(page, "Insert Track").hover();
  const noFootage = page
    .getByRole("menu", { name: "Insert Track" })
    .getByRole("menuitem", { name: trackName });
  await expect(noFootage).toHaveAttribute("aria-disabled", "true");
  await expect(noFootage).toHaveAttribute("title", "No footage here");

  // Clear selection is the Escape equivalent.
  await page.keyboard.press("Escape");
  await menuItem(page, "Clear selection").click();
  await expect(page.locator(".timeline-selection")).toHaveCount(0);

  // Right-clicking outside the selection opens the lane menu and clears it.
  await dragSelection(lane(page, "6"), 600, 700);
  await rightClickLaneAt(lane(page, "6"), 300);
  await expect(page.getByRole("menu", { name: "Layer actions" })).toBeVisible();
  await expect(page.locator(".timeline-selection")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // With nothing focused, Shift+F10 opens the selection menu on it.
  await dragSelection(lane(page, "6"), 600, 700);
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur(),
  );
  await page.keyboard.press("Shift+F10");
  await expect(menu).toBeVisible();
  await expect(lane(page, "6").locator(".timeline-selection")).toBeVisible();
});
