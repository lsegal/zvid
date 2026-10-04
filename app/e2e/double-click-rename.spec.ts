import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// Double-clicking a layer or source track name renames it inline, like
// Rename… in its menu (#940). Default layers: "5" is Layer 2.
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

// The saved session payload, or null when nothing is saved.
function readSavedPayload(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string | null>((resolve, reject) => {
        const request = indexedDB.open("zvid-workspace");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains("sessions")) {
            database.close();
            resolve(null);
            return;
          }
          const get = database
            .transaction("sessions", "readonly")
            .objectStore("sessions")
            .get("current");
          get.onerror = () => reject(get.error);
          get.onsuccess = () => {
            database.close();
            resolve(
              (get.result as { payload?: string } | undefined)?.payload ?? null,
            );
          };
        };
      }),
  );
}

function layerName(page: Page, id: string) {
  return page.locator(`[data-lane-label-id="${id}"]`);
}

function layerNames(page: Page) {
  return page.locator("[data-layer-header-id] .track-label__select > span");
}

function sourceTrackName(page: Page) {
  return page.locator("[data-source-track-label-id]");
}

function sourceTrackNames(page: Page) {
  return page.locator("[data-source-track-label-id] > span");
}

// Checks the field has focus with all of its text selected.
async function expectFocusedAndSelected(input: Locator) {
  await expect(input).toBeFocused();
  await expect
    .poll(() =>
      input.evaluate(
        (element: HTMLInputElement) =>
          element.selectionStart === 0 &&
          element.selectionEnd === element.value.length,
      ),
    )
    .toBe(true);
}

test.use({ viewport: { width: 1600, height: 1200 } });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-timeline-lane-id="1"]')).toBeVisible();
});

test("double-clicking a layer name renames it inline", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Layer name" });

  // The double-click selects the layer too, and puts the selected name in
  // the field.
  await layerName(page, "5").dblclick();
  await expect(input).toHaveValue("Layer 2");
  await expectFocusedAndSelected(input);
  await expect(page.locator(".fx-panel__toggle")).toHaveText("Layer 2 Effects");

  // Escape cancels.
  await input.fill("Ignored");
  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(layerNames(page)).toHaveText(["Layer 1", "Layer 2", "Layer 3"]);

  // Enter saves.
  await layerName(page, "5").dblclick();
  await input.fill("Drums");
  await input.press("Enter");
  await expect(layerNames(page)).toHaveText(["Layer 1", "Drums", "Layer 3"]);

  // Leaving the field saves.
  await layerName(page, "5").dblclick();
  await input.fill("Bass");
  await page.locator(".fx-panel__toggle").click();
  await expect(input).toHaveCount(0);
  await expect(layerNames(page)).toHaveText(["Layer 1", "Bass", "Layer 3"]);

  // A single click only selects.
  await layerName(page, "1").click();
  await expect(page.locator(".fx-panel__toggle")).toHaveText("Layer 1 Effects");
  await expect(input).toHaveCount(0);
});

test("double-clicking a source track name renames it inline", async ({
  page,
}) => {
  await dropVideoIntoNewSourceTrack(page);
  const input = page.getByRole("textbox", { name: "Source track name" });

  await sourceTrackName(page).dblclick();
  await expect(input).toHaveValue("test-pattern");
  await expectFocusedAndSelected(input);
  await expect(
    page.locator(".track-row--source[data-source-track-id]"),
  ).toHaveClass(/track-row--selected/);

  // Escape cancels and puts focus back on the name.
  await input.fill("Ignored");
  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(sourceTrackNames(page)).toHaveText(["test-pattern"]);
  await expect(sourceTrackName(page)).toBeFocused();

  // Enter saves.
  await sourceTrackName(page).dblclick();
  await input.fill("Wide shot");
  await input.press("Enter");
  await expect(sourceTrackNames(page)).toHaveText(["Wide shot"]);

  // Leaving the field saves.
  await sourceTrackName(page).dblclick();
  await input.fill("Close-up");
  await layerName(page, "1").click();
  await expect(input).toHaveCount(0);
  await expect(sourceTrackNames(page)).toHaveText(["Close-up"]);
});

test("a read-only tab ignores a double-click on a name", async ({
  page,
  context,
}) => {
  await dropVideoIntoNewSourceTrack(page);
  await expect
    .poll(
      async () =>
        (await readSavedPayload(page))?.includes("test-pattern.mp4") ?? false,
      { timeout: 10_000 },
    )
    .toBe(true);

  const second = await context.newPage();
  await second.goto("/");
  await second
    .getByRole("dialog", { name: "This session is open in another tab" })
    .getByRole("button", { name: "Open read-only" })
    .click();
  await expect(sourceTrackNames(second)).toHaveText(["test-pattern"]);

  await layerName(second, "5").dblclick();
  await sourceTrackName(second).dblclick();
  await expect(second.getByRole("textbox", { name: "Layer name" })).toHaveCount(
    0,
  );
  await expect(
    second.getByRole("textbox", { name: "Source track name" }),
  ).toHaveCount(0);
  await expect(
    second.getByRole("dialog", { name: "This tab is read-only" }),
  ).toBeHidden();
});
