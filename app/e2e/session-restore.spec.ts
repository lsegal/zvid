import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// The open session, its undo history and view state are saved in IndexedDB,
// so a refresh brings them back. Only one tab saves the session at a time.
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

async function copySpanToLayer(page: Page, layer: string) {
  await page.locator(".source-span").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy to layer" }).hover();
  await page.getByRole("menuitem", { name: layer }).click();
}

// The saved session payload, or null when nothing is saved.
// File ▸ New Session, discarding any unsaved changes.
async function startNewSession(page: Page) {
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "New Session" }).click();
  const prompt = page.getByRole("dialog", {
    name: "Save changes to this session?",
  });
  await expect(prompt.or(page.getByText("No source media yet"))).toBeVisible();
  if (await prompt.isVisible()) {
    await prompt.getByRole("button", { name: "Don't Save" }).click();
  }
}

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

// Waits until the autosave has written a session that mentions `text`.
async function waitForSave(page: Page, text: string) {
  await expect
    .poll(async () => (await readSavedPayload(page))?.includes(text) ?? false, {
      timeout: 10_000,
    })
    .toBe(true);
}

async function openFileMenu(page: Page) {
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  await expect(page.getByRole("menu").first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
});

test("a refresh restores the session, its media and its undo history", async ({
  page,
}) => {
  await dropVideoIntoNewSourceTrack(page);
  await copySpanToLayer(page, "Layer 1");
  await copySpanToLayer(page, "Layer 2");
  await expect(page.locator(".clip-card")).toHaveCount(2);
  // The clip on Layer 2 ("5") is the last edit.
  await waitForSave(page, '"laneId":"5"');

  await page.reload();

  await expect(page.locator(".source-span")).toHaveCount(1);
  await expect(lane(page, "1").locator(".clip-card")).toHaveCount(1);
  await expect(lane(page, "5").locator(".clip-card")).toHaveCount(1);
  // The media comes back from the media cache without a re-import.
  await openFileMenu(page);
  await expect(
    page.getByRole("menuitem", { name: "All Media Linked" }),
  ).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");

  // Undo reverts the last action made before the refresh.
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Undo/ }).click();
  await expect(lane(page, "5").locator(".clip-card")).toHaveCount(0);
  await expect(lane(page, "1").locator(".clip-card")).toHaveCount(1);
});

test("File ▸ New Session clears the saved session", async ({ page }) => {
  await dropVideoIntoNewSourceTrack(page);
  await waitForSave(page, "test-pattern.mp4");

  await startNewSession(page);
  await expect(page.locator(".source-span")).toHaveCount(0);
  await expect.poll(() => readSavedPayload(page)).toBeNull();

  await page.reload();
  await expect(lane(page, "1")).toBeVisible();
  await expect(page.locator(".source-span")).toHaveCount(0);
});

test("a saved session that cannot be read is set aside", async ({ page }) => {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("zvid-workspace");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("sessions", "readwrite");
          transaction.objectStore("sessions").put({
            id: "current",
            schemaVersion: 1,
            savedAt: 1,
            payload: "{not json",
          });
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
  );

  await page.reload();

  await expect(
    page.getByText("Could not restore the last session"),
  ).toBeVisible();
  await expect(lane(page, "1")).toBeVisible();
  await expect(page.locator(".source-span")).toHaveCount(0);
});

test("a second tab asks before taking the session over", async ({
  page,
  context,
}) => {
  await dropVideoIntoNewSourceTrack(page);
  await waitForSave(page, "test-pattern.mp4");

  const second = await context.newPage();
  await second.goto("/");
  const prompt = second.getByRole("dialog", {
    name: "This session is open in another tab",
  });
  await expect(prompt).toBeVisible();
  // The second tab shows the saved session behind the prompt.
  await expect(second.locator(".source-span")).toHaveCount(1);

  await prompt.getByRole("button", { name: "Open read-only" }).click();
  await expect(prompt).toBeHidden();
  await expect(second.locator(".workspace-lock-banner")).toContainText(
    "open in another tab",
  );

  // An edit in the first tab is saved before the second takes over.
  await copySpanToLayer(page, "Layer 1");
  await second.getByRole("button", { name: "Take over" }).click();
  await expect(second.locator(".clip-card")).toHaveCount(1);
  await expect(second.locator(".workspace-lock-banner")).toBeHidden();
  await expect(page.locator(".workspace-lock-banner")).toContainText(
    "taken over in another tab",
  );
});

test("a read-only tab refuses edits until it takes the session over", async ({
  page,
  context,
}) => {
  await dropVideoIntoNewSourceTrack(page);
  await waitForSave(page, "test-pattern.mp4");

  const second = await context.newPage();
  await second.goto("/");
  await second
    .getByRole("dialog", { name: "This session is open in another tab" })
    .getByRole("button", { name: "Open read-only" })
    .click();
  const prompt = second.getByRole("dialog", { name: "This tab is read-only" });

  // It can't add layers or source tracks.
  await expect(
    second
      .locator(".track-placeholder--layer")
      .getByRole("button", { name: "Layer", exact: true }),
  ).toBeDisabled();
  await expect(
    second
      .locator(".track-row--source-drop")
      .getByRole("button", { name: "Track", exact: true }),
  ).toBeDisabled();

  // An edit asks to take over instead of being made and thrown away.
  await copySpanToLayer(second, "Layer 1");
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText("open in another tab");
  await prompt.getByRole("button", { name: "Stay read-only" }).click();
  await expect(prompt).toBeHidden();
  await expect(second.locator(".clip-card")).toHaveCount(0);

  // So does Undo.
  await second.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await second.getByRole("menuitem", { name: /^Undo/ }).click();
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Stay read-only" }).click();
  await expect(second.locator(".source-span")).toHaveCount(1);

  // Zoom still works.
  const zoom = second.getByRole("slider", { name: "Timeline zoom" });
  const zoomBefore = await zoom.inputValue();
  await second.getByRole("button", { name: "Zoom in" }).click();
  await expect(zoom).not.toHaveValue(zoomBefore);
  await expect(prompt).toBeHidden();

  // Take over from the prompt restores full editing.
  await copySpanToLayer(second, "Layer 1");
  await prompt.getByRole("button", { name: "Take over" }).click();
  await expect(prompt).toBeHidden();
  await expect(second.locator(".workspace-lock-banner")).toBeHidden();
  await copySpanToLayer(second, "Layer 1");
  await expect(second.locator(".clip-card")).toHaveCount(1);

  // The tab that was taken over refuses edits in turn.
  await expect(page.locator(".workspace-lock-banner")).toContainText(
    "taken over in another tab",
  );
  await copySpanToLayer(page, "Layer 2");
  const takenOverPrompt = page.getByRole("dialog", {
    name: "This tab is read-only",
  });
  await expect(takenOverPrompt).toContainText("taken over in another tab");
  await expect(page.locator(".clip-card")).toHaveCount(0);
});

// Sessions saved since every session got a default Order keep their Global
// stack as saved; older saves get that Order added once when restored.
test("a restored session keeps a removed Order, and an older one gets it", async ({
  page,
}) => {
  const order = page.locator('section[aria-label="Order"]');
  await page.locator('[data-layer-header-id="1"]').click();
  await expect(order).toHaveCount(1);
  await order.getByRole("button", { name: "Remove Order" }).click();
  await expect(order).toHaveCount(0);
  // Saved once the removal is in the undo history.
  await waitForSave(page, "Remove Order");
  expect(await readSavedPayload(page)).toContain('"orderDefaulted":true');

  await page.reload();
  await page.locator('[data-layer-header-id="1"]').click();
  await expect(order).toHaveCount(0);

  // The same session as a build from before the default Order saved it.
  // Edited from a blank page of the same origin, with the app closed: its
  // unload flush and any pending autosave would otherwise write the live
  // session back over the edit.
  await page.route("**/blank.html", (route) =>
    route.fulfill({ contentType: "text/html", body: "" }),
  );
  await page.goto("/blank.html");
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("zvid-workspace");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("sessions", "readwrite");
          const store = transaction.objectStore("sessions");
          const get = store.get("current");
          get.onsuccess = () => {
            const record = get.result as { payload: string };
            store.put({
              ...record,
              payload: record.payload.replace(
                /,?"orderDefaulted":true,?/g,
                (match) =>
                  match.startsWith(",") && match.endsWith(",") ? "," : "",
              ),
            });
          };
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
  );
  expect(await readSavedPayload(page)).not.toContain("orderDefaulted");

  await page.goto("/");
  await page.locator('[data-layer-header-id="1"]').click();
  await expect(order).toHaveCount(1);
  await expect(order).toContainText("Vertical");
});

test("a refresh restores the selected source clip", async ({ page }) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  await dropVideoIntoNewSourceTrack(page);
  await page.locator(".source-span").click();
  await expect(page.locator(".source-span")).toHaveClass(
    /source-span--selected/,
  );
  await waitForSave(page, '"selectedSourceSpanId"');

  await page.reload();
  await expect(page.locator(".source-span")).toHaveClass(
    /source-span--selected/,
  );
  await expect(
    page.locator(".track-label--source .track-label__select"),
  ).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".clip-card--selected")).toHaveCount(0);
});
