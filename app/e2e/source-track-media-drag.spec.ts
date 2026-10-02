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

// With the Media tab open a small window leaves the timeline so little room
// that the drop positions fall in the band where the browser scrolls the
// timeline during a drag.
test.use({ viewport: { width: 1600, height: 1200 } });

async function dropVideoIntoNewSourceTrack(
  page: Page,
  file = VIDEO,
  type = "video/webm",
) {
  const base64 = (await readFile(file)).toString("base64");
  const name = file.pathname.split("/").pop() ?? "";
  const dataTransfer = await page.evaluateHandle(
    ({ data, name, type }) => {
      const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], name, { type }));
      return transfer;
    },
    { data: base64, name, type },
  );
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

// Moves the drag just past timeline position `q` in `row` until the row's
// drop preview shows it there, as a person lines a drop up, then drops it.
// Re-aiming each time keeps the drop on `q` if the timeline shifts during
// the drag.
async function dropAtQ(page: Page, row: Locator, q: number, quarterPx: number) {
  const preview = row.locator(".source-drop-preview");
  await expect
    .poll(async () => {
      const bounds = await box(row.locator(content));
      await page.mouse.move(
        (await xOf(row, q, quarterPx)) + 2,
        bounds.y + bounds.height / 2,
        { steps: 4 },
      );
      if (!(await preview.isVisible())) {
        return undefined;
      }
      return Math.round(
        ((await box(preview)).x - (await xOf(row, 0, quarterPx))) / quarterPx,
      );
    })
    .toBe(q);
  await page.mouse.up();
}

// Opens the app with the fixture in a source track and the Media drawer.
async function openWithMedia(page: Page) {
  await page.goto("/");
  await dropVideoIntoNewSourceTrack(page);
  const row = page.locator(tracks).first();
  const quarterPx = (await box(row.locator(".source-span"))).width / 6;
  await page.getByRole("button", { name: "Time", exact: true }).click();
  await page.getByRole("button", { name: "Media", exact: true }).click();
  await expect(mediaItems(page)).toHaveCount(1);
  return { row, quarterPx };
}

// Opens the app with the fixture in a source track and the Media drawer, and
// sets the media's In and Out points to 1 and 2 seconds.
async function openWithRange(page: Page) {
  const { row, quarterPx } = await openWithMedia(page);

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
  await dropAtQ(page, row, 12, quarterPx);

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
  await dropAtQ(page, newRow, 4, quarterPx);

  await expect(page.locator(tracks)).toHaveCount(2);
  const added = page.locator(tracks).nth(1);
  await expect(added).toContainText("test-pattern-audio");
  await expect.poll(() => layout(added, quarterPx)).toEqual([[4, 2]]);
  await expect.poll(() => layout(row, quarterPx)).toEqual([[0, 6]]);
  await expect(mediaItems(page)).toHaveCount(1);
});

test("media dragged from the drawer onto the Audio row or a layer does nothing", async ({
  page,
}) => {
  const { row, quarterPx } = await openWithRange(page);
  const layer = page.locator('[data-timeline-lane-id="1"]');
  const audioLane = page.locator("[data-audio-row]");
  const summary = await audioLane.locator(".track-label small").textContent();
  const spans = await page.locator(".source-span").count();

  await startDrag(page, mediaItems(page), row.locator(content));
  await dropAt(page, audioLane, (await box(audioLane)).x + 200);
  await expect(page.locator(".source-drop-preview")).toHaveCount(0);
  await expect(page.locator(".source-span")).toHaveCount(spans);
  await expect(audioLane.locator(".track-label small")).toHaveText(
    summary ?? "",
  );

  await startDrag(page, mediaItems(page), row.locator(content));
  await dropAt(page, layer, (await box(layer)).x + 200);
  await expect(page.locator(".source-drop-preview")).toHaveCount(0);
  await expect.poll(() => layout(row, quarterPx)).toEqual([[0, 6]]);
  await expect(page.locator(tracks)).toHaveCount(1);
  await expect(page.locator(".clip-card")).toHaveCount(0);
});

// The drop preview of ranged media is the clip the drop creates (#715): as
// wide, and showing the frame at its In point.
test("the drop preview of media from the drawer is as long as its In/Out range", async ({
  page,
}) => {
  const { row, quarterPx } = await openWithRange(page);

  await startDrag(page, mediaItems(page), row.locator(content));
  const preview = row.locator(".source-drop-preview--clips");
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("test-pattern-audio");
  await expect(preview).toContainText("Video · 0:01.0");
  await expect(preview.locator(".source-drop-clip__thumb")).toHaveAttribute(
    "data-thumbnail-key",
    /:1\.000$/,
  );
  await expect(preview.locator(".source-drop-clip")).toHaveAttribute(
    "data-in-seconds",
    "1",
  );
  const previewWidth = (await box(preview)).width;
  expect(previewWidth).toBeCloseTo(2 * quarterPx, 0);
  await dropAtQ(page, row, 12, quarterPx);

  await expect(row.locator(".source-span")).toHaveCount(2);
  const dropped = (await box(row.locator(".source-span").nth(1))).width;
  expect(Math.abs(previewWidth - dropped)).toBeLessThanOrEqual(1);
});

test("the drop preview of media without a range spans its whole length", async ({
  page,
}) => {
  const { row, quarterPx } = await openWithMedia(page);
  await row.locator(".track-label--source").scrollIntoViewIfNeeded();

  await startDrag(page, mediaItems(page), row.locator(content));
  const preview = row.locator(".source-drop-preview--clips");
  await expect(preview).toBeVisible();
  await expect(preview.locator(".source-drop-clip__thumb")).toHaveAttribute(
    "data-thumbnail-key",
    /:0\.000$/,
  );
  const previewWidth = (await box(preview)).width;
  const full = (await box(row.locator(".source-span"))).width;
  expect(Math.abs(previewWidth - full)).toBeLessThanOrEqual(1);
  await dropAtQ(page, row, 8, quarterPx);
  await expect
    .poll(() => layout(row, quarterPx))
    .toEqual([
      [0, 6],
      [8, 6],
    ]);
});

test("the drop preview of audio-only media draws its waveform", async ({
  page,
}) => {
  await page.goto("/");
  await dropVideoIntoNewSourceTrack(
    page,
    new URL("./fixtures/tone.wav", import.meta.url),
    "audio/wav",
  );
  const row = page.locator(tracks).first();
  await page.getByRole("button", { name: "Media", exact: true }).click();
  await expect(mediaItems(page)).toHaveCount(1);
  await row.locator(".track-label--source").scrollIntoViewIfNeeded();

  await startDrag(page, mediaItems(page), row.locator(content));
  const preview = row.locator(".source-drop-preview--clips");
  await expect(preview.locator(".source-drop-clip--audio")).toBeVisible();
  await expect(preview.locator(".source-drop-clip__waveform")).toBeVisible();
  await expect(preview.locator(".source-drop-clip__thumb")).toHaveCount(0);
  const previewWidth = (await box(preview)).width;
  const full = (await box(row.locator(".source-span"))).width;
  expect(Math.abs(previewWidth - full)).toBeLessThanOrEqual(1);
  await page.mouse.up();
});
