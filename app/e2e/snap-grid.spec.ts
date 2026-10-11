// Stays in Playwright: it saves the session to IndexedDB, edits the saved
// payload with the app closed and reloads the app, which only the whole app's
// session restore and save can show.
import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// Snapping always follows the zoom-adaptive grid (#732), also in a session
// saved with an old snap mode. A four-second test pattern at 120 BPM spans
// eight quarters. At 100% zoom the grid is in eighth notes (half a quarter).
// The toolbar and the snapping drags are component tests:
// TimelineToolbar.component.test.tsx and SourceSpan.snap.component.test.tsx.
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
