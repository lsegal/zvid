import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// Snapping always follows the zoom-adaptive grid: there is no snap grid
// selector, only the Snap On/Off toggle, with the tempo control right of it
// (#732). A four-second test pattern at 120 BPM spans eight quarters. At 100%
// zoom the grid is in eighth notes (half a quarter); at 25% it is in quarters.
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

const header = '[aria-label="Source track drop area"]';
const tracks = '[data-source-track-drop-target="track"]';

async function box(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (!bounds) {
    throw new Error("element is not visible");
  }
  return bounds;
}

// Opens the app with one source track holding one clip at 0 and returns the
// clip and the timeline's quarter width.
async function openWithSpan(page: Page) {
  await page.goto("/");
  const base64 = (await readFile(VIDEO)).toString("base64");
  const dataTransfer = await page.evaluateHandle((data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([bytes], "test-pattern.mp4", { type: "video/mp4" }),
    );
    return transfer;
  }, base64);
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(header, type, { dataTransfer });
  }
  const span = page.locator(`${tracks} .source-span`);
  await expect(span).toHaveCount(1, { timeout: 30_000 });
  return { span, quarterPx: await quarterWidth(span) };
}

async function quarterWidth(span: Locator) {
  return (await box(span)).width / 8;
}

// Where a span starts in its track, in quarters.
function startQ(span: Locator, quarterPx: number) {
  return span.evaluate(
    (element, px) =>
      Math.round(
        (Number.parseFloat((element as HTMLElement).style.left) / px) * 100,
      ) / 100,
    quarterPx,
  );
}

// Drags `span`'s body horizontally by `deltaPx`, snapping as usual.
async function dragBy(page: Page, span: Locator, deltaPx: number) {
  const handle = span.locator(".source-span__body");
  await handle.scrollIntoViewIfNeeded();
  const bounds = await box(handle);
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + deltaPx, y, { steps: 8 });
  await page.mouse.up();
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

test("the toolbar has no snap grid selector and the tempo sits right of Snap", async ({
  page,
}) => {
  await page.goto("/");
  const toolbar = page.locator(".timeline-toolbar");
  await expect(toolbar).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Snap grid" })).toHaveCount(0);
  await expect(toolbar.getByRole("button", { name: /^Auto/ })).toHaveCount(0);

  // The tempo control directly follows the Snap toggle's group.
  const snap = toolbar.getByRole("button", { name: "Snap On" });
  await expect(snap).toBeVisible();
  const tempo = toolbar.locator(".tempo-pill");
  await expect(tempo).toHaveCount(1);
  expect(
    await snap.evaluate(
      (button) =>
        button.parentElement?.nextElementSibling?.classList.contains(
          "tempo-pill",
        ) ?? false,
    ),
  ).toBe(true);
  await expect(page.locator(".topbar .tempo-pill")).toHaveCount(0);

  // −/+ still step the tempo, with undo.
  await expect(tempo).toContainText("120 BPM");
  await tempo.getByRole("button", { name: "Increase tempo" }).click();
  await expect(tempo).toContainText("125 BPM");
  await tempo.getByRole("button", { name: "Decrease tempo" }).click();
  await tempo.getByRole("button", { name: "Decrease tempo" }).click();
  await expect(tempo).toContainText("115 BPM");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(tempo).toContainText("120 BPM");
});

test("dragging a clip snaps to the zoom-dependent grid", async ({ page }) => {
  const { span, quarterPx } = await openWithSpan(page);
  expect(await startQ(span, quarterPx)).toBe(0);

  // At 100% the grid is in eighth notes, so 3.4 quarters snaps to 3.5.
  await dragBy(page, span, 3.4 * quarterPx);
  await expect.poll(() => startQ(span, quarterPx)).toBe(3.5);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => startQ(span, quarterPx)).toBe(0);

  // Zoomed out to 25% the grid is in quarters, so 3.4 quarters snaps to 3.
  const zoomOut = page.getByRole("button", { name: "Zoom out", exact: true });
  while (await zoomOut.isEnabled()) {
    await zoomOut.click();
  }
  await expect(page.locator(".zoom-control__readout")).toHaveText("25%");
  const zoomedQuarterPx = await quarterWidth(span);
  await dragBy(page, span, 3.4 * zoomedQuarterPx);
  await expect.poll(() => startQ(span, zoomedQuarterPx)).toBe(3);
});

test("a session saved with a snap mode loads and snaps adaptively", async ({
  page,
}) => {
  await openWithSpan(page);
  await expect
    .poll(async () => (await readSavedPayload(page))?.includes("snapEnabled"))
    .toBe(true);

  // Edited from a blank page of the same origin, with the app closed, so the
  // live session is not written back over the edit.
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
              payload: record.payload.replaceAll(
                '"snapEnabled":',
                '"snapMode":"beat","snapEnabled":',
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
  expect(await readSavedPayload(page)).toContain('"snapMode":"beat"');

  await page.goto("/");
  const span = page.locator(`${tracks} .source-span`);
  await expect(span).toHaveCount(1, { timeout: 30_000 });
  const quarterPx = await quarterWidth(span);

  // A beat grid would snap 3.4 quarters to 3; the adaptive grid gives 3.5.
  await dragBy(page, span, 3.4 * quarterPx);
  await expect.poll(() => startQ(span, quarterPx)).toBe(3.5);

  // The next save no longer writes the snap mode.
  await expect
    .poll(async () => (await readSavedPayload(page))?.includes("snapMode"), {
      timeout: 10_000,
    })
    .toBe(false);
});
