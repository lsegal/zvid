import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  dropFiles,
  expectCount,
  type FixtureName,
  fileTransfer,
  fixtureFile,
  mouse,
  query,
  queryAll,
  renderApp,
} from "../../../component-test/app.tsx";
import { setViewport } from "../../../component-test/viewport.ts";

// Media dragged from the Media drawer onto a source track (#685) starts at
// the snapped pointer position, reuses the media item and is pre-trimmed to
// its In/Out points. The fixture is a three-second test pattern, six quarters
// at 120 BPM.

const tracks = '[data-source-track-drop-target="track"]';
const content = ".track-row__content--source";
const newTrackRow = ".track-row--source-drop";

// Playwright's default expect timeout, for waits on media loading in.
const wait = { timeout: 10_000 };

// Playwright's ControlOrMeta: Cmd on macOS, Ctrl elsewhere.
const mod = /mac/i.test(navigator.platform) ? "Meta" : "Control";

// With the Media tab open a small window leaves the timeline so little room
// that the drop positions fall in the band where the browser scrolls the
// timeline during a drag.
async function open() {
  await setViewport({ width: 1600, height: 1200 });
  await renderApp();
}

async function dropVideoIntoNewSourceTrack(
  fixture: FixtureName = "test-pattern-audio.webm",
) {
  await dropFiles(
    query('[data-source-track-drop-target="new-track"]'),
    fileTransfer([await fixtureFile(fixture)]),
  );
  await expectCount(".source-span", 1, 30_000);
}

function box(element: Element | null | undefined) {
  if (!element) {
    throw new Error("element is not visible");
  }
  return element.getBoundingClientRect();
}

function within(row: Element, selector: string) {
  const element = row.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`missing ${selector}`);
  }
  return element;
}

// The first source track, found afresh: drops and undo re-render it.
function firstTrack() {
  return query(tracks);
}

const mediaItems = () =>
  page.getByRole("listbox", { name: "Media items" }).getByRole("option");

function mediaItemCount() {
  return mediaItems().elements().length;
}

// Chromium's scrollIntoViewIfNeeded, which Playwright's matches.
function scrollIntoViewIfNeeded(element: Element) {
  (
    element as Element & { scrollIntoViewIfNeeded(center?: boolean): void }
  ).scrollIntoViewIfNeeded(true);
}

// The client x of timeline position `q` in `row`'s timeline, which starts
// inside the content's left border.
function xOf(row: Element, q: number, quarterPx: number) {
  const element = within(row, content);
  return (
    element.getBoundingClientRect().left + element.clientLeft + q * quarterPx
  );
}

// Where each span in `row` sits, in quarters, in timeline order.
function layout(row: Element, quarterPx: number) {
  const round = (value: string) =>
    Math.round((Number.parseFloat(value) / quarterPx) * 100) / 100;
  return [...row.querySelectorAll<HTMLElement>(".source-span")]
    .map((element) => [round(element.style.left), round(element.style.width)])
    .sort((a, b) => a[0] - b[0]);
}

function isVisible(element: Element | null) {
  return Boolean(element?.checkVisibility());
}

// Starts dragging the drawer's media item with the mouse, which drives a real
// HTML drag, and moves it over the timeline so the drop targets show. The
// drag starts near the item's top, which the drawer's status bar never
// covers.
async function startDrag(over: Element) {
  const item = box(mediaItems().element());
  await mouse.move(item.left + 20, item.top + 12);
  await mouse.down();
  // The timeline is wider than the window, so stay near its start.
  const to = box(over);
  await mouse.move(to.x + 100, to.y + to.height / 2, 8);
}

// Moves the drag to `clientX` over the middle of `target` and drops it.
async function dropAt(target: Element, clientX: number) {
  const bounds = box(target);
  await mouse.move(clientX, bounds.y + bounds.height / 2, 8);
  await mouse.up();
}

// Moves the drag just past timeline position `q` in `row` until the row's
// drop preview shows it there, as a person lines a drop up, then drops it.
// Re-aiming each time keeps the drop on `q` if the timeline shifts during
// the drag.
async function dropAtQ(row: () => Element, q: number, quarterPx: number) {
  await expect
    .poll(async () => {
      const bounds = box(within(row(), content));
      await mouse.move(
        xOf(row(), q, quarterPx) + 2,
        bounds.y + bounds.height / 2,
        4,
      );
      const preview = row().querySelector(".source-drop-preview");
      if (!isVisible(preview)) {
        return undefined;
      }
      return Math.round(
        (box(preview).x - xOf(row(), 0, quarterPx)) / quarterPx,
      );
    }, wait)
    .toBe(q);
  await mouse.up();
}

// Opens the app with the fixture in a source track and the Media drawer.
async function openWithMedia() {
  await open();
  await dropVideoIntoNewSourceTrack();
  const quarterPx = box(firstTrack().querySelector(".source-span")).width / 6;
  await page.getByRole("button", { name: "Time", exact: true }).click();
  await page.getByRole("button", { name: "Media", exact: true }).click();
  await expect.poll(mediaItemCount, wait).toBe(1);
  return { quarterPx };
}

// Opens the app with the fixture in a source track and the Media drawer, and
// sets the media's In and Out points to 1 and 2 seconds.
async function openWithRange() {
  const { quarterPx } = await openWithMedia();

  await mediaItems().dblClick();
  await expect
    .poll(
      () =>
        document.querySelector<HTMLVideoElement>(".media-preview video")
          ?.readyState ?? 0,
      wait,
    )
    .toBeGreaterThan(0);
  for (const [seconds, key] of [
    [1, "i"],
    [2, "o"],
  ] as const) {
    await page
      .getByRole("slider", { name: "Media position" })
      .fill(String(seconds));
    await userEvent.click(query(".media-preview__picture"));
    await userEvent.keyboard(key);
  }
  // Playwright's toHaveText collapses whitespace, line breaks included.
  await expect
    .poll(
      () =>
        page
          .getByTestId("media-range-readout")
          .element()
          .textContent?.replace(/\s+/g, " "),
      wait,
    )
    .toMatch(/In 00:01:00.*Out 00:02:00/);
  // The Media tab leaves the timeline little room; show the source track.
  scrollIntoViewIfNeeded(within(firstTrack(), ".track-label--source"));
  return { quarterPx };
}

function field(name: string) {
  return page
    .elementLocator(query(".source-clip-properties"))
    .getByRole("spinbutton", { name });
}

test("media dragged from the drawer starts at the pointer, trimmed to its In/Out points", async () => {
  const { quarterPx } = await openWithRange();

  await startDrag(within(firstTrack(), content));
  await expect
    .poll(
      () => isVisible(firstTrack().querySelector(".source-drop-preview")),
      wait,
    )
    .toBe(true);
  expect(within(firstTrack(), ".source-drop-preview").textContent).toContain(
    "test-pattern-audio",
  );
  await dropAtQ(firstTrack, 12, quarterPx);

  // One second of media is two quarters, from 12.
  await expect
    .poll(() => firstTrack().querySelectorAll(".source-span").length, wait)
    .toBe(2);
  await expect
    .poll(() => layout(firstTrack(), quarterPx), wait)
    .toEqual([
      [0, 6],
      [12, 2],
    ]);
  // No new media item: the clip reuses the one in the drawer.
  await expect.poll(mediaItemCount, wait).toBe(1);
  await expectCount(".source-drop-preview", 0, wait.timeout);

  // It plays the media from its In point.
  await userEvent.click(firstTrack().querySelectorAll(".source-span")[1]);
  await expect
    .poll(() => document.querySelector(".source-clip-properties"), wait)
    .toBeTruthy();
  await expect
    .element(field("Offset"), wait)
    .toHaveAttribute("aria-valuetext", "00:01:00");
  await expect
    .element(field("Length"), wait)
    .toHaveAttribute("aria-valuetext", "00:01:00");

  // The drop is one undo step.
  await userEvent.keyboard(`{${mod}>}z{/${mod}}`);
  await expect
    .poll(() => layout(firstTrack(), quarterPx), wait)
    .toEqual([[0, 6]]);
  await expect.poll(mediaItemCount, wait).toBe(1);
}, 120_000);

test("media dragged from the drawer onto the new-track row starts a track", async () => {
  const { quarterPx } = await openWithRange();

  await startDrag(within(firstTrack(), content));
  await expect
    .poll(() => isVisible(document.querySelector(newTrackRow)), wait)
    .toBe(true);
  query(newTrackRow).scrollIntoView({ block: "nearest" });
  await dropAtQ(() => query(newTrackRow), 4, quarterPx);

  await expectCount(tracks, 2, wait.timeout);
  const added = () => queryAll(tracks)[1];
  await expect
    .poll(() => added().textContent, wait)
    .toContain("test-pattern-audio");
  await expect.poll(() => layout(added(), quarterPx), wait).toEqual([[4, 2]]);
  await expect
    .poll(() => layout(firstTrack(), quarterPx), wait)
    .toEqual([[0, 6]]);
  await expect.poll(mediaItemCount, wait).toBe(1);
}, 120_000);

test("media dragged from the drawer onto the Audio row or a layer does nothing", async () => {
  const { quarterPx } = await openWithRange();
  const layer = query('[data-timeline-lane-id="1"]');
  const audioLane = query("[data-audio-row]");
  const summary = within(audioLane, ".track-label small").textContent;
  const spans = queryAll(".source-span").length;

  await startDrag(within(firstTrack(), content));
  await dropAt(audioLane, box(audioLane).x + 200);
  await expectCount(".source-drop-preview", 0, wait.timeout);
  await expectCount(".source-span", spans, wait.timeout);
  await expect
    .poll(
      () => within(query("[data-audio-row]"), ".track-label small").textContent,
      wait,
    )
    .toBe(summary ?? "");

  await startDrag(within(firstTrack(), content));
  await dropAt(layer, box(layer).x + 200);
  await expectCount(".source-drop-preview", 0, wait.timeout);
  await expect
    .poll(() => layout(firstTrack(), quarterPx), wait)
    .toEqual([[0, 6]]);
  await expectCount(tracks, 1, wait.timeout);
  await expectCount(".clip-card", 0, wait.timeout);
}, 120_000);

// The drop preview of ranged media is the clip the drop creates (#715): as
// wide, and showing the frame at its In point.
test("the drop preview of media from the drawer is as long as its In/Out range", async () => {
  const { quarterPx } = await openWithRange();

  await startDrag(within(firstTrack(), content));
  const preview = () => within(firstTrack(), ".source-drop-preview--clips");
  await expect
    .poll(
      () =>
        isVisible(firstTrack().querySelector(".source-drop-preview--clips")),
      wait,
    )
    .toBe(true);
  await expect
    .poll(() => preview().textContent, wait)
    .toContain("test-pattern-audio");
  await expect
    .poll(() => preview().textContent, wait)
    .toContain("Video · 0:01.0");
  await expect
    .poll(
      () =>
        preview()
          .querySelector(".source-drop-clip__thumb")
          ?.getAttribute("data-thumbnail-key"),
      wait,
    )
    .toMatch(/:1\.000$/);
  await expect
    .poll(() => preview().querySelector(".source-drop-clip"), wait)
    .toHaveAttribute("data-in-seconds", "1");
  const previewWidth = box(preview()).width;
  expect(previewWidth).toBeCloseTo(2 * quarterPx, 0);
  await dropAtQ(firstTrack, 12, quarterPx);

  await expect
    .poll(() => firstTrack().querySelectorAll(".source-span").length, wait)
    .toBe(2);
  const dropped = box(firstTrack().querySelectorAll(".source-span")[1]).width;
  expect(Math.abs(previewWidth - dropped)).toBeLessThanOrEqual(1);
}, 120_000);

test("the drop preview of media without a range spans its whole length", async () => {
  const { quarterPx } = await openWithMedia();
  scrollIntoViewIfNeeded(within(firstTrack(), ".track-label--source"));

  await startDrag(within(firstTrack(), content));
  const preview = () => within(firstTrack(), ".source-drop-preview--clips");
  await expect
    .poll(
      () =>
        isVisible(firstTrack().querySelector(".source-drop-preview--clips")),
      wait,
    )
    .toBe(true);
  await expect
    .poll(
      () =>
        preview()
          .querySelector(".source-drop-clip__thumb")
          ?.getAttribute("data-thumbnail-key"),
      wait,
    )
    .toMatch(/:0\.000$/);
  const previewWidth = box(preview()).width;
  const full = box(firstTrack().querySelector(".source-span")).width;
  expect(Math.abs(previewWidth - full)).toBeLessThanOrEqual(1);
  await dropAtQ(firstTrack, 8, quarterPx);
  await expect
    .poll(() => layout(firstTrack(), quarterPx), wait)
    .toEqual([
      [0, 6],
      [8, 6],
    ]);
}, 120_000);

test("the drop preview of audio-only media draws its waveform", async () => {
  await open();
  await dropVideoIntoNewSourceTrack("tone.wav");
  await page.getByRole("button", { name: "Media", exact: true }).click();
  await expect.poll(mediaItemCount, wait).toBe(1);
  scrollIntoViewIfNeeded(within(firstTrack(), ".track-label--source"));

  await startDrag(within(firstTrack(), content));
  const preview = () => within(firstTrack(), ".source-drop-preview--clips");
  await expect
    .poll(
      () =>
        isVisible(
          firstTrack().querySelector(
            ".source-drop-preview--clips .source-drop-clip--audio",
          ),
        ),
      wait,
    )
    .toBe(true);
  await expect
    .poll(
      () => isVisible(preview().querySelector(".source-drop-clip__waveform")),
      wait,
    )
    .toBe(true);
  expect(preview().querySelectorAll(".source-drop-clip__thumb")).toHaveLength(
    0,
  );
  const previewWidth = box(preview()).width;
  const full = box(firstTrack().querySelector(".source-span")).width;
  expect(Math.abs(previewWidth - full)).toBeLessThanOrEqual(1);
  await mouse.up();
}, 120_000);
