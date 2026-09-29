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
