import { readFile } from "node:fs/promises";
import {
  expect,
  type JSHandle,
  type Locator,
  type Page,
  test,
} from "@playwright/test";

// Media dropped on a source track row starts at the snapped timeline
// position under the pointer (#679). A four-second test pattern at 120 BPM
// spans eight quarters, and 12 quarters is on every snap division, so a drop
// two pixels past it (under half the finest grid spacing) snaps to it.
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

const header = '[aria-label="Source track drop area"]';
const tracks = '[data-source-track-drop-target="track"]';
const content = ".track-row__content--source";
const newTrackRow = ".track-row--source-drop";

async function videoTransfer(page: Page, count: number) {
  const base64 = (await readFile(VIDEO)).toString("base64");
  return page.evaluateHandle(
    ({ data, count }) => {
      const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      for (let index = 0; index < count; index += 1) {
        transfer.items.add(
          new File([bytes], `test-pattern-${index}.mp4`, { type: "video/mp4" }),
        );
      }
      return transfer;
    },
    { data: base64, count },
  );
}

async function box(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (!bounds) {
    throw new Error("element is not visible");
  }
  return bounds;
}

// Fires drag events at `clientX` over the middle of `target`'s row.
async function dragAt(
  target: Locator,
  clientX: number,
  dataTransfer: JSHandle<DataTransfer>,
  types: string[],
  shiftKey = false,
) {
  const bounds = await box(target);
  const clientY = bounds.y + bounds.height / 2;
  for (const type of types) {
    await target.dispatchEvent(type, {
      dataTransfer,
      clientX,
      clientY,
      shiftKey,
    });
  }
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

// The client x of the left edge of the last span in `row`'s timeline.
function lastSpanX(row: Locator) {
  return row
    .locator(".source-span")
    .evaluateAll((elements) =>
      Math.max(
        ...elements.map((element) => element.getBoundingClientRect().left),
      ),
    );
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

// Opens the app with one source track holding one clip at 0 and returns the
// track row and the timeline's quarter width.
async function openWithTrack(page: Page) {
  await page.goto("/");
  const dataTransfer = await videoTransfer(page, 1);
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(header, type, { dataTransfer });
  }
  await expect(page.locator(tracks)).toHaveCount(1);
  const row = page.locator(tracks).first();
  const span = row.locator(".source-span");
  await expect(span).toHaveCount(1, { timeout: 30_000 });
  const widthPx = await span.evaluate((element) =>
    Number.parseFloat((element as HTMLElement).style.width),
  );
  return { row, quarterPx: widthPx / 8 };
}

test("media dropped on a track starts at the snapped pointer position", async ({
  page,
}) => {
  const { row, quarterPx } = await openWithTrack(page);

  await dragAt(
    row.locator(content),
    (await xOf(row, 12, quarterPx)) + 2,
    await videoTransfer(page, 1),
    ["dragenter", "dragover", "drop"],
  );
  await expect(row.locator(".source-span")).toHaveCount(2, {
    timeout: 30_000,
  });
  await expect
    .poll(() => layout(row, quarterPx))
    .toEqual([
      [0, 8],
      [12, 8],
    ]);

  // Shift skips snapping, as when moving a clip, and the clip starts right
  // under the pointer (#696).
  const pointerX = await xOf(row, 24.5, quarterPx);
  await dragAt(
    row.locator(content),
    pointerX,
    await videoTransfer(page, 1),
    ["dragenter", "dragover", "drop"],
    true,
  );
  await expect(row.locator(".source-span")).toHaveCount(3, {
    timeout: 30_000,
  });
  const [, , [unsnappedQ, unsnappedDurationQ]] = await layout(row, quarterPx);
  expect(Math.abs(unsnappedQ - 24.5)).toBeLessThan(0.5 / quarterPx);
  expect(unsnappedDurationQ).toBe(8);
  expect(Math.abs((await lastSpanX(row)) - pointerX)).toBeLessThan(0.5);
});

test("several files dropped on a track follow each other and overwrite the clips they land on", async ({
  page,
}) => {
  const { row, quarterPx } = await openWithTrack(page);

  // Two clips dropped over the first clip, at 4.
  await dragAt(
    row.locator(".source-span"),
    await xOf(row, 4, quarterPx),
    await videoTransfer(page, 2),
    ["dragenter", "dragover", "drop"],
  );
  await expect(row.locator(".source-span")).toHaveCount(3, {
    timeout: 30_000,
  });
  // The first clip keeps its uncovered start, as when a clip is moved onto
  // it.
  await expect
    .poll(() => layout(row, quarterPx))
    .toEqual([
      [0, 4],
      [4, 8],
      [12, 8],
    ]);

  // The drop is one undo step.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => layout(row, quarterPx)).toEqual([[0, 8]]);
});

test("media dropped over the label column starts at 0", async ({ page }) => {
  const { row, quarterPx } = await openWithTrack(page);
  const label = row.locator(".track-label--source");

  await dragAt(label, (await box(label)).x + 10, await videoTransfer(page, 1), [
    "dragenter",
    "dragover",
    "drop",
  ]);
  await expect
    .poll(() => layout(row, quarterPx), { timeout: 30_000 })
    .toEqual([[0, 8]]);
  await expect(row.locator(".source-span")).toHaveCount(1);
});

test("media dropped on the new-track row starts its track at the pointer", async ({
  page,
}) => {
  const { row, quarterPx } = await openWithTrack(page);
  const dataTransfer = await videoTransfer(page, 1);

  await dragAt(
    row.locator(content),
    await xOf(row, 2, quarterPx),
    dataTransfer,
    ["dragenter", "dragover"],
  );
  const newRow = page.locator(newTrackRow);
  await expect(newRow).toBeVisible();
  await dragAt(
    newRow.locator(content),
    (await xOf(newRow, 12, quarterPx)) + 2,
    dataTransfer,
    ["dragover", "drop"],
  );

  await expect(page.locator(tracks)).toHaveCount(2, { timeout: 30_000 });
  const added = page.locator(tracks).nth(1);
  await expect(added.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
  await expect.poll(() => layout(added, quarterPx)).toEqual([[12, 8]]);
  await expect.poll(() => layout(row, quarterPx)).toEqual([[0, 8]]);
});

test("a locked track takes dropped media after its last clip", async ({
  page,
}) => {
  const { row, quarterPx } = await openWithTrack(page);
  await page.locator(".source-header__lock").click();
  await expect(page.locator(".source-header__lock")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await dragAt(
    row.locator(".source-span"),
    await xOf(row, 4, quarterPx),
    await videoTransfer(page, 1),
    ["dragenter", "dragover", "drop"],
  );
  await expect(row.locator(".source-span")).toHaveCount(2, {
    timeout: 30_000,
  });
  await expect
    .poll(() => layout(row, quarterPx))
    .toEqual([
      [0, 8],
      [8, 8],
    ]);
});

test("the drop preview follows the pointer and the timeline's scroll", async ({
  page,
}) => {
  const { row, quarterPx } = await openWithTrack(page);
  const dataTransfer = await videoTransfer(page, 1);
  const preview = row.locator(".source-drop-preview");
  const indicator = row.locator(".source-drop-indicator");
  const previewQ = async () =>
    Math.round(
      ((await box(preview)).x - (await box(row.locator(content))).x) /
        quarterPx,
    );

  await dragAt(
    row.locator(content),
    (await xOf(row, 12, quarterPx)) + 2,
    dataTransfer,
    ["dragenter", "dragover"],
  );
  await expect(preview).toBeVisible();
  await expect(indicator).toBeVisible();
  await expect.poll(previewQ).toBe(12);

  await dragAt(
    row.locator(content),
    (await xOf(row, 20, quarterPx)) + 2,
    dataTransfer,
    ["dragover"],
  );
  await expect.poll(previewQ).toBe(20);
  // The insertion line is centered on the card's left edge.
  expect(
    Math.abs((await box(indicator)).x + 1 - (await box(preview)).x),
  ).toBeLessThan(1.5);

  // Scrolling the timeline by 4 quarters moves the position under a
  // pointer that stays put 4 quarters later.
  const pointerX = (await xOf(row, 20, quarterPx)) + 2;
  await page.locator(".timeline-scroll").evaluate((element, px) => {
    element.scrollLeft += px;
  }, 4 * quarterPx);
  await dragAt(row.locator(content), pointerX, dataTransfer, ["dragover"]);
  await expect.poll(previewQ).toBe(24);
  expect(Math.abs((await box(preview)).x - (pointerX - 2))).toBeLessThan(0.5);
});
