import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// Media dragged from the Media drawer onto a source track (#685) starts at
// the snapped pointer position, reuses the media item and is pre-trimmed to
// its In/Out points. The fixture is a three-second test pattern, six quarters
// at 120 BPM.
const VIDEO = new URL("./fixtures/test-pattern-audio.webm", import.meta.url);

const tracks = '[data-source-track-drop-target="track"]';
const content = ".track-row__content--source";
const newTrackRow = ".track-row--source-drop";

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

async function box(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (!bounds) {
    throw new Error("element is not visible");
  }
  return bounds;
}

function mediaItems(page: Page) {
  return page.getByRole("listbox", { name: "Media items" }).getByRole("option");
}

// The client x of timeline position `q` in `row`'s timeline, which starts
// inside the content's left border.
async function xOf(row: Locator, q: number, quarterPx: number) {
  const origin = await row
    .locator(content)
    .evaluate(
      (element) => element.getBoundingClientRect().left + element.clientLeft,
    );
  return origin + q * quarterPx;
}

// Where each span in `row` sits, in quarters, in timeline order.
async function layout(row: Locator, quarterPx: number) {
  return row.locator(".source-span").evaluateAll(
    (elements, px) =>
      elements
        .map((element) => {
          const style = (element as HTMLElement).style;
          const round = (value: string) =>
            Math.round((Number.parseFloat(value) / px) * 100) / 100;
          return [round(style.left), round(style.width)];
        })
        .sort((a, b) => a[0] - b[0]),
    quarterPx,
  );
}

// Starts dragging the drawer's media item with the mouse, which drives a real
// HTML drag, and moves it over the timeline so the drop targets show. The
// drag starts near the item's top, which the drawer's status bar never
// covers.
async function startDrag(page: Page, item: Locator, over: Locator) {
  await item.hover({ position: { x: 20, y: 12 } });
  await page.mouse.down();
  // The timeline is wider than the window, so stay near its start.
  const to = await box(over);
  await page.mouse.move(to.x + 100, to.y + to.height / 2, { steps: 8 });
}

// Moves the drag to `clientX` over the middle of `target` and drops it.
async function dropAt(page: Page, target: Locator, clientX: number) {
  const bounds = await box(target);
  await page.mouse.move(clientX, bounds.y + bounds.height / 2, { steps: 8 });
  await page.mouse.up();
}

// Opens the app with the fixture in a source track and the Media drawer, and
// sets the media's In and Out points to 1 and 2 seconds.
async function openWithRange(page: Page) {
  await page.goto("/");
  await dropVideoIntoNewSourceTrack(page);
  const row = page.locator(tracks).first();
  const quarterPx = (await box(row.locator(".source-span"))).width / 6;
  await page.getByRole("button", { name: "SMPTE", exact: true }).click();
  await page.getByRole("button", { name: "Media", exact: true }).click();
  await expect(mediaItems(page)).toHaveCount(1);

  await mediaItems(page).dblclick();
  const video = page.locator(".media-preview video");
  await expect
    .poll(() =>
      video.evaluate((element) => (element as HTMLVideoElement).readyState),
    )
    .toBeGreaterThan(0);
  for (const [seconds, key] of [
    [1, "i"],
    [2, "o"],
  ] as const) {
    await page
      .getByRole("slider", { name: "Media position" })
      .fill(String(seconds));
    await page.locator(".media-preview__picture").click();
    await page.keyboard.press(key);
  }
  await expect(page.getByTestId("media-range-readout")).toHaveText(
    /In 00:01:00.*Out 00:02:00/,
  );
  // The Media tab leaves the timeline little room; show the source track.
  await row.locator(".track-label--source").scrollIntoViewIfNeeded();
  return { row, quarterPx };
}

function field(page: Page, name: string) {
  return page
    .locator(".source-clip-properties")
    .getByRole("spinbutton", { name });
}

test("media dragged from the drawer starts at the pointer, trimmed to its In/Out points", async ({
  page,
}) => {
  const { row, quarterPx } = await openWithRange(page);

  await startDrag(page, mediaItems(page), row.locator(content));
  await expect(row.locator(".source-drop-preview")).toBeVisible();
  await expect(row.locator(".source-drop-preview")).toContainText(
    "test-pattern-audio",
  );
  await dropAt(page, row.locator(content), (await xOf(row, 12, quarterPx)) + 2);

  // One second of media is two quarters, from 12.
  await expect(row.locator(".source-span")).toHaveCount(2);
  await expect
    .poll(() => layout(row, quarterPx))
    .toEqual([
      [0, 6],
      [12, 2],
    ]);
  // No new media item: the clip reuses the one in the drawer.
  await expect(mediaItems(page)).toHaveCount(1);
  await expect(page.locator(".source-drop-preview")).toHaveCount(0);

  // It plays the media from its In point.
  await row.locator(".source-span").nth(1).click();
  await expect(field(page, "Offset")).toHaveAttribute(
    "aria-valuetext",
    "00:01:00",
  );
  await expect(field(page, "Length")).toHaveAttribute(
    "aria-valuetext",
    "00:01:00",
  );

  // The drop is one undo step.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => layout(row, quarterPx)).toEqual([[0, 6]]);
  await expect(mediaItems(page)).toHaveCount(1);
});

test("media dragged from the drawer onto the new-track row starts a track", async ({
  page,
}) => {
  const { row, quarterPx } = await openWithRange(page);

  await startDrag(page, mediaItems(page), row.locator(content));
  const newRow = page.locator(newTrackRow);
  await expect(newRow).toBeVisible();
  await newRow.evaluate((element) =>
    element.scrollIntoView({ block: "nearest" }),
  );
  await dropAt(
    page,
    newRow.locator(content),
    (await xOf(newRow, 4, quarterPx)) + 2,
  );

  await expect(page.locator(tracks)).toHaveCount(2);
  const added = page.locator(tracks).nth(1);
  await expect(added).toContainText("test-pattern-audio");
  await expect.poll(() => layout(added, quarterPx)).toEqual([[4, 2]]);
  await expect.poll(() => layout(row, quarterPx)).toEqual([[0, 6]]);
  await expect(mediaItems(page)).toHaveCount(1);
});

test("media dragged from the drawer onto the Audio lane or a layer does nothing", async ({
  page,
}) => {
  const { row, quarterPx } = await openWithRange(page);
  const layer = page.locator('[data-timeline-lane-id="1"]');
  const audioLane = page.locator("[data-main-audio-drop-target]");
  await expect(audioLane).toContainText("No main audio");

  await startDrag(page, mediaItems(page), row.locator(content));
  await dropAt(page, audioLane, (await box(audioLane)).x + 200);
  await expect(page.locator(".source-drop-preview")).toHaveCount(0);
  await expect(audioLane).toContainText("No main audio");

  await startDrag(page, mediaItems(page), row.locator(content));
  await dropAt(page, layer, (await box(layer)).x + 200);
  await expect(page.locator(".source-drop-preview")).toHaveCount(0);
  await expect.poll(() => layout(row, quarterPx)).toEqual([[0, 6]]);
  await expect(page.locator(tracks)).toHaveCount(1);
  await expect(page.locator(".clip-card")).toHaveCount(0);
});
