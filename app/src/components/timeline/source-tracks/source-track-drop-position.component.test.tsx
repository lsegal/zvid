import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { getShortcutLabels } from "../../../app/shortcut-labels.ts";
import {
  dispatchDrag,
  dropFiles,
  expectCount,
  fileTransfer,
  fixtureFile,
  nextFrame,
  query,
  queryAll,
  renderApp,
} from "../../../component-test/app.tsx";

// Media dropped on a source track row starts at the snapped timeline
// position under the pointer (#679). A four-second test pattern at 120 BPM
// spans eight quarters, and 12 quarters is on every snap division, so a drop
// two pixels past it (under half the finest grid spacing) snaps to it.

const header = '[aria-label="Source track drop area"]';
const tracks = '[data-source-track-drop-target="track"]';
const content = ".track-row__content--source";
const newTrackRow = ".track-row--source-drop";

async function videoTransfer(count: number) {
  const files: File[] = [];
  for (let index = 0; index < count; index += 1) {
    files.push(
      await fixtureFile("test-pattern.mp4", `test-pattern-${index}.mp4`),
    );
  }
  return fileTransfer(files);
}

function within(row: Element, selector: string) {
  const element = row.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`missing ${selector}`);
  }
  return element;
}

function spansOf(row: Element) {
  return [...row.querySelectorAll<HTMLElement>(".source-span")];
}

// Fires drag events at `clientX` over the middle of `target`'s row.
async function dragAt(
  target: Element,
  clientX: number,
  transfer: DataTransfer,
  types: string[],
  shiftKey = false,
) {
  const bounds = target.getBoundingClientRect();
  const clientY = bounds.top + bounds.height / 2;
  await dispatchDrag(target, types, transfer, { clientX, clientY, shiftKey });
}

// The client x of timeline position `q` in `row`'s timeline, which starts
// inside the content's left border.
function xOf(row: Element, q: number, quarterPx: number) {
  const element = within(row, content);
  return (
    element.getBoundingClientRect().left + element.clientLeft + q * quarterPx
  );
}

// The client x of the left edge of the last span in `row`'s timeline.
function lastSpanX(row: Element) {
  return Math.max(
    ...spansOf(row).map((element) => element.getBoundingClientRect().left),
  );
}

// Where each span in `row` sits, in quarters, in timeline order.
function layout(row: Element, quarterPx: number) {
  const round = (value: string) =>
    Math.round((Number.parseFloat(value) / quarterPx) * 100) / 100;
  return spansOf(row)
    .map(({ style }) => [round(style.left), round(style.width)])
    .sort((a, b) => a[0] - b[0]);
}

function undo() {
  const mod = getShortcutLabels().mac ? "Meta" : "Control";
  return userEvent.keyboard(`{${mod}>}z{/${mod}}`);
}

// Opens the app with one source track holding one clip at 0 and returns the
// track row and the timeline's quarter width.
async function openWithTrack() {
  await renderApp();
  await dropFiles(query(header), await videoTransfer(1));
  await expectCount(tracks, 1);
  const row = query(tracks);
  await expectCount(`${tracks} .source-span`, 1, 30_000);
  const widthPx = Number.parseFloat(spansOf(row)[0].style.width);
  return { row, quarterPx: widthPx / 8 };
}

test("media dropped on a track starts at the snapped pointer position", async () => {
  const { row, quarterPx } = await openWithTrack();

  await dragAt(
    within(row, content),
    xOf(row, 12, quarterPx) + 2,
    await videoTransfer(1),
    ["dragenter", "dragover", "drop"],
  );
  await expect.poll(() => spansOf(row).length, { timeout: 30_000 }).toBe(2);
  await expect
    .poll(() => layout(row, quarterPx))
    .toEqual([
      [0, 8],
      [12, 8],
    ]);

  // Shift skips snapping, as when moving a clip, and the clip starts right
  // under the pointer (#696).
  const pointerX = xOf(row, 24.5, quarterPx);
  await dragAt(
    within(row, content),
    pointerX,
    await videoTransfer(1),
    ["dragenter", "dragover", "drop"],
    true,
  );
  await expect.poll(() => spansOf(row).length, { timeout: 30_000 }).toBe(3);
  const [, , [unsnappedQ, unsnappedDurationQ]] = layout(row, quarterPx);
  expect(Math.abs(unsnappedQ - 24.5)).toBeLessThan(0.5 / quarterPx);
  expect(unsnappedDurationQ).toBe(8);
  expect(Math.abs(lastSpanX(row) - pointerX)).toBeLessThan(0.5);
}, 90_000);

test("several files dropped on a track follow each other and overwrite the clips they land on", async () => {
  const { row, quarterPx } = await openWithTrack();

  // Two clips dropped over the first clip, at 4.
  await dragAt(
    within(row, ".source-span"),
    xOf(row, 4, quarterPx),
    await videoTransfer(2),
    ["dragenter", "dragover", "drop"],
  );
  await expect.poll(() => spansOf(row).length, { timeout: 30_000 }).toBe(3);
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
  await undo();
  await expect.poll(() => layout(row, quarterPx)).toEqual([[0, 8]]);
}, 90_000);

test("media dropped over the label column starts at 0", async () => {
  const { row, quarterPx } = await openWithTrack();
  const label = within(row, ".track-label--source");

  await dragAt(
    label,
    label.getBoundingClientRect().left + 10,
    await videoTransfer(1),
    ["dragenter", "dragover", "drop"],
  );
  await expect
    .poll(() => layout(row, quarterPx), { timeout: 30_000 })
    .toEqual([[0, 8]]);
  expect(spansOf(row)).toHaveLength(1);
}, 90_000);

test("media dropped on the new-track row starts its track at the pointer", async () => {
  const { row, quarterPx } = await openWithTrack();
  const transfer = await videoTransfer(1);

  await dragAt(within(row, content), xOf(row, 2, quarterPx), transfer, [
    "dragenter",
    "dragover",
  ]);
  await expectCount(newTrackRow, 1);
  const newRow = query(newTrackRow);
  await expect.element(newRow).toBeVisible();
  newRow.scrollIntoView({ block: "nearest" });
  await nextFrame();
  await dragAt(
    within(newRow, content),
    xOf(newRow, 12, quarterPx) + 2,
    transfer,
    ["dragover", "drop"],
  );

  await expectCount(tracks, 2, 30_000);
  const added = () => queryAll(tracks)[1];
  await expect.poll(() => spansOf(added()).length, { timeout: 30_000 }).toBe(1);
  await expect.poll(() => layout(added(), quarterPx)).toEqual([[12, 8]]);
  await expect.poll(() => layout(row, quarterPx)).toEqual([[0, 8]]);
}, 90_000);

test("a locked track takes dropped media after its last clip", async () => {
  const { row, quarterPx } = await openWithTrack();
  await userEvent.click(query(".source-header__lock"));
  await expect
    .element(query(".source-header__lock"))
    .toHaveAttribute("aria-pressed", "true");

  await dragAt(
    within(row, ".source-span"),
    xOf(row, 4, quarterPx),
    await videoTransfer(1),
    ["dragenter", "dragover", "drop"],
  );
  await expect.poll(() => spansOf(row).length, { timeout: 30_000 }).toBe(2);
  await expect
    .poll(() => layout(row, quarterPx))
    .toEqual([
      [0, 8],
      [8, 8],
    ]);
}, 90_000);

test("the drop preview follows the pointer and the timeline's scroll", async () => {
  const { row, quarterPx } = await openWithTrack();
  const transfer = await videoTransfer(1);
  const preview = () => within(row, ".source-drop-preview");
  const indicator = () => within(row, ".source-drop-indicator");
  const previewQ = () =>
    Math.round(
      (preview().getBoundingClientRect().left -
        within(row, content).getBoundingClientRect().left) /
        quarterPx,
    );

  await dragAt(within(row, content), xOf(row, 12, quarterPx) + 2, transfer, [
    "dragenter",
    "dragover",
  ]);
  await expectCount(`${tracks} .source-drop-preview`, 1);
  await expect.element(preview()).toBeVisible();
  await expectCount(`${tracks} .source-drop-indicator`, 1);
  await expect.element(indicator()).toBeVisible();
  await expect.poll(previewQ).toBe(12);

  await dragAt(within(row, content), xOf(row, 20, quarterPx) + 2, transfer, [
    "dragover",
  ]);
  await expect.poll(previewQ).toBe(20);
  // The insertion line is centered on the card's left edge.
  expect(
    Math.abs(
      indicator().getBoundingClientRect().left +
        1 -
        preview().getBoundingClientRect().left,
    ),
  ).toBeLessThan(1.5);

  // Scrolling the timeline by 4 quarters moves the position under a
  // pointer that stays put 4 quarters later.
  const pointerX = xOf(row, 20, quarterPx) + 2;
  query(".timeline-scroll").scrollLeft += 4 * quarterPx;
  await nextFrame();
  await dragAt(within(row, content), pointerX, transfer, ["dragover"]);
  await expect.poll(previewQ).toBe(24);
  expect(
    Math.abs(preview().getBoundingClientRect().left - (pointerX - 2)),
  ).toBeLessThan(0.5);
}, 90_000);
