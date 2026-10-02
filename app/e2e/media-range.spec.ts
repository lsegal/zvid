import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// In/Out points on media in the Media tab: set with I and O or by dragging
// the markers, shown on the scrub bar, the readout and the Media drawer,
// undoable, cleared, and kept across a reload. The fixture is a three-second
// test pattern with a tone.
const VIDEO = new URL("./fixtures/test-pattern-audio.webm", import.meta.url);

async function dropVideoIntoNewSourceTrack(page: Page) {
  const base64 = (await readFile(VIDEO)).toString("base64");
  const dataTransfer = await page.evaluateHandle((data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([bytes], "test-pattern-audio.webm", { type: "video/webm" }),
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

function mediaItem(page: Page) {
  return page.getByRole("option").filter({ hasText: "test-pattern-audio" });
}

function marker(page: Page, point: "In" | "Out") {
  return page.getByRole("slider", { name: `Media ${point} point` });
}

async function markerSeconds(page: Page, point: "In" | "Out") {
  return Number(await marker(page, point).getAttribute("aria-valuenow"));
}

async function openInMediaTab(page: Page) {
  await mediaItem(page).dblclick();
  const video = page.locator(".media-preview video");
  await expect(video).toBeVisible();
  await expect
    .poll(() =>
      video.evaluate((element) => (element as HTMLVideoElement).readyState),
    )
    .toBeGreaterThan(0);
}

// Moves the media playhead and puts focus back in the Media tab.
async function seekMedia(page: Page, seconds: number) {
  await page
    .getByRole("slider", { name: "Media position" })
    .fill(String(seconds));
  await page.locator(".media-preview__picture").click();
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

test("In/Out points are set, dragged, undone, kept and cleared", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator('[data-timeline-lane-id="1"]')).toBeVisible();
  await dropVideoIntoNewSourceTrack(page);
  await page.getByRole("button", { name: "Time", exact: true }).click();
  await page.getByRole("button", { name: "Media", exact: true }).click();
  await openInMediaTab(page);

  const readout = page.getByTestId("media-range-readout");
  const dims = page.locator("[data-media-range-dim]");
  const badge = mediaItem(page).locator(".media-badge--range");
  const clear = page.getByRole("button", { name: "Clear", exact: true });

  // Without a range the whole file is used: nothing dimmed or badged.
  await expect(readout).toHaveText(/In 00:00:00.*Out 00:03:00/);
  await expect(dims).toHaveCount(0);
  await expect(badge).toHaveCount(0);
  await expect(clear).toBeDisabled();

  // I and O set the points at the media playhead.
  await seekMedia(page, 1);
  await page.keyboard.press("i");
  await seekMedia(page, 2);
  await page.keyboard.press("o");
  await expect(readout).toHaveText(
    /In 00:01:00.*Out 00:02:00.*Duration 00:01:00/,
  );
  await expect(dims).toHaveCount(2);
  await expect(badge).toBeVisible();
  await expect.poll(() => markerSeconds(page, "In")).toBe(1);
  await expect.poll(() => markerSeconds(page, "Out")).toBe(2);

  // Dragging the Out marker moves it, snapped to a frame.
  const bar = await page.locator(".media-range").boundingBox();
  const out = await marker(page, "Out").boundingBox();
  if (!bar || !out) {
    throw new Error("The scrub bar is not laid out");
  }
  await page.mouse.move(out.x + out.width / 2, out.y + out.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar.x + bar.width * (2.5 / 3), out.y + out.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  await expect.poll(() => markerSeconds(page, "Out")).toBeCloseTo(2.5, 1);
  const dragged = await markerSeconds(page, "Out");
  expect(Math.abs(dragged * 30 - Math.round(dragged * 30))).toBeLessThan(1e-6);

  // Undo puts the Out point back.
  await page.locator(".media-preview__picture").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => markerSeconds(page, "Out")).toBe(2);

  // The range is saved with the session and comes back after a reload.
  await expect
    .poll(
      async () =>
        (await readSavedPayload(page))?.includes('"rangeOutSeconds":2') ??
        false,
      { timeout: 10_000 },
    )
    .toBe(true);
  await page.reload();
  await expect(badge).toBeVisible({ timeout: 30_000 });
  await openInMediaTab(page);
  await expect.poll(() => markerSeconds(page, "In")).toBe(1);
  await expect.poll(() => markerSeconds(page, "Out")).toBe(2);
  await expect(dims).toHaveCount(2);

  // Clear goes back to the whole file.
  await clear.click();
  await expect(dims).toHaveCount(0);
  await expect(badge).toHaveCount(0);
  await expect(readout).toHaveText(/In 00:00:00.*Out 00:03:00/);
});

test("I and O do nothing outside the Media tab and drawer", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator('[data-timeline-lane-id="1"]')).toBeVisible();
  await dropVideoIntoNewSourceTrack(page);
  await page.getByRole("button", { name: "Media", exact: true }).click();
  await openInMediaTab(page);

  await page.locator(".source-span").click();
  await page.keyboard.press("i");
  await page.keyboard.press("o");
  await expect(page.locator("[data-media-range-dim]")).toHaveCount(0);
  await expect(mediaItem(page).locator(".media-badge--range")).toHaveCount(0);
});
