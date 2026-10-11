import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import {
  dispatchDrag,
  dropFiles,
  expectCount,
  fileTransfer,
  fixtureFile,
  mouse,
  nextFrame,
  pressMod,
  query,
  queryAll,
  renderApp,
} from "../../../component-test/app.tsx";

// Source clips move by dragging their body and trim by dragging an edge, and
// overwrite the clips they land on in their own source track the way clips
// do on a layer. Dragged onto another source track's row, they move there. A four-second test pattern at 120 BPM spans eight quarters.
// Shift is held while dragging so the drags skip snapping and move by exact
// quarters at any zoom.

const header = '[aria-label="Source track drop area"]';
const tracks = '[data-source-track-drop-target="track"]';

async function videoTransfer(count: number) {
  const files: File[] = [];
  for (let index = 0; index < count; index += 1) {
    files.push(
      await fixtureFile("test-pattern.mp4", `test-pattern-${index}.mp4`),
    );
  }
  return fileTransfer(files);
}

// The spans in the `index`th source track.
function spansIn(index: number) {
  const track = queryAll(tracks)[index];
  return track ? [...track.querySelectorAll<HTMLElement>(".source-span")] : [];
}

function within(element: Element, selector: string) {
  const found = element.querySelector<HTMLElement>(selector);
  if (!found) {
    throw new Error(`missing ${selector}`);
  }
  return found;
}

// Where a span sits in its track, in quarters.
function layout(span: HTMLElement, quarterPx: number) {
  const round = (value: string) =>
    Math.round((Number.parseFloat(value) / quarterPx) * 100) / 100;
  return {
    startQ: round(span.style.left),
    durationQ: round(span.style.width),
  };
}

function undo() {
  return pressMod("z");
}

function redo() {
  return pressMod("z", { shift: true });
}

function middle(element: Element) {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

// Moves the real mouse from (x, y) to (toX, toY) with Shift held and the
// button down, running `whileDown` before the release.
async function shiftDrag(
  from: { x: number; y: number },
  to: { x: number; y: number },
  whileDown?: () => Promise<void>,
) {
  await userEvent.keyboard("{Shift>}");
  await mouse.move(from.x, from.y);
  await mouse.down();
  await mouse.move(to.x, to.y, 8);
  await whileDown?.();
  await mouse.up();
  await userEvent.keyboard("{/Shift}");
}

// Drags `handle` horizontally by `deltaPx` with Shift held.
async function dragBy(handle: HTMLElement, deltaPx: number) {
  handle.scrollIntoView({ block: "nearest", inline: "nearest" });
  await nextFrame();
  const { x, y } = middle(handle);
  await shiftDrag({ x, y }, { x: x + deltaPx, y });
}

// Opens the app with one source track holding `count` back-to-back clips and
// returns the timeline's quarter width.
async function openWithSpans(count: number) {
  await renderApp();
  await dropFiles(query(header), await videoTransfer(count));
  await expectCount(tracks, 1);
  await expectCount(`${tracks} .source-span`, count, 30_000);
  return query(`${tracks} .source-span`).getBoundingClientRect().width / 8;
}

// Adds a second source track with its own clip, dropped on the new-track
// row shown while media is dragged over tracks.
async function addSecondTrack() {
  const transfer = await videoTransfer(1);
  await dispatchDrag(query(tracks), ["dragenter", "dragover"], transfer);
  await expectCount(".track-row--source-drop", 1);
  await dropFiles(query(".track-row--source-drop"), transfer);
  await expectCount(tracks, 2, 30_000);
}

test("source clips move and trim from either edge, looping their media, with undo", async () => {
  const quarterPx = await openWithSpans(1);
  const span = () => query(".source-span");
  await expect
    .poll(() => layout(span(), quarterPx))
    .toEqual({
      startQ: 0,
      durationQ: 8,
    });

  // A press released without moving changes nothing.
  await userEvent.click(span());
  await nextFrame();
  await nextFrame();
  expect(layout(span(), quarterPx)).toEqual({ startQ: 0, durationQ: 8 });

  // Move it 4 quarters later, then undo the one step.
  await dragBy(within(span(), ".source-span__body"), 4 * quarterPx);
  await expect
    .poll(() => layout(span(), quarterPx))
    .toEqual({
      startQ: 4,
      durationQ: 8,
    });
  await undo();
  await expect
    .poll(() => layout(span(), quarterPx))
    .toEqual({
      startQ: 0,
      durationQ: 8,
    });
  await redo();
  await expect
    .poll(() => layout(span(), quarterPx))
    .toEqual({
      startQ: 4,
      durationQ: 8,
    });

  // Trim 2 quarters off the end, then 2 off the start.
  await mouse.moveTo(span());
  await dragBy(within(span(), ".source-span__handle--end"), -2 * quarterPx);
  await expect
    .poll(() => layout(span(), quarterPx))
    .toEqual({
      startQ: 4,
      durationQ: 6,
    });
  await mouse.moveTo(span());
  await dragBy(within(span(), ".source-span__handle--start"), 2 * quarterPx);
  await expect
    .poll(() => layout(span(), quarterPx))
    .toEqual({
      startQ: 6,
      durationQ: 4,
    });

  // The start stops at the media's first frame, but the end runs on past
  // its last, looping the media, with a marker where it loops.
  await mouse.moveTo(span());
  await dragBy(within(span(), ".source-span__handle--start"), -5 * quarterPx);
  await expect
    .poll(() => layout(span(), quarterPx))
    .toEqual({
      startQ: 4,
      durationQ: 6,
    });
  await mouse.moveTo(span());
  const markers = () =>
    span().querySelectorAll<HTMLElement>(".media-loop-markers__marker");
  await expect.poll(() => markers().length).toBe(0);
  await dragBy(within(span(), ".source-span__handle--end"), 6 * quarterPx);
  await expect
    .poll(() => layout(span(), quarterPx))
    .toEqual({
      startQ: 4,
      durationQ: 12,
    });
  await expect.poll(() => markers().length).toBe(1);
  expect(Number.parseFloat(markers()[0].style.left) / quarterPx).toBeCloseTo(
    8,
    1,
  );

  // Moving never goes before the start of the timeline.
  await dragBy(within(span(), ".source-span__body"), -10 * quarterPx);
  await expect
    .poll(() => layout(span(), quarterPx))
    .toEqual({
      startQ: 0,
      durationQ: 12,
    });
}, 90_000);

test("a source clip dragged over another in its track trims it like a layer, and other tracks are unaffected", async () => {
  const quarterPx = await openWithSpans(2);
  await addSecondTrack();
  const first = () => spansIn(0);
  await expect.poll(() => first().length).toBe(2);
  const other = () => spansIn(1);
  await expect.poll(() => other().length, { timeout: 30_000 }).toBe(1);

  const left = () => first()[0];
  const right = () => first()[1];
  await expect
    .poll(() => layout(right(), quarterPx))
    .toEqual({
      startQ: 8,
      durationQ: 8,
    });

  // The right clip moved 4 quarters back trims the left one to what it
  // leaves uncovered.
  await dragBy(within(right(), ".source-span__body"), -4 * quarterPx);
  await expect
    .poll(() => layout(right(), quarterPx))
    .toEqual({
      startQ: 4,
      durationQ: 8,
    });
  await expect
    .poll(() => layout(left(), quarterPx))
    .toEqual({
      startQ: 0,
      durationQ: 4,
    });
  expect(layout(other()[0], quarterPx)).toEqual({ startQ: 0, durationQ: 8 });

  // Moved over all that is left of the left clip, it removes it.
  await dragBy(within(right(), ".source-span__body"), -4 * quarterPx);
  await expect.poll(() => first().length).toBe(1);
  await expect
    .poll(() => layout(first()[0], quarterPx))
    .toEqual({
      startQ: 0,
      durationQ: 8,
    });
  expect(other()).toHaveLength(1);
  expect(layout(other()[0], quarterPx)).toEqual({ startQ: 0, durationQ: 8 });

  // Undo brings back the trimmed clip, then its original length.
  await undo();
  await expect.poll(() => first().length).toBe(2);
  await undo();
  await expect
    .poll(() => layout(first()[0], quarterPx))
    .toEqual({
      startQ: 0,
      durationQ: 8,
    });
  await expect
    .poll(() => layout(first()[1], quarterPx))
    .toEqual({
      startQ: 8,
      durationQ: 8,
    });
}, 90_000);

test("a source clip dragged onto another source track moves there, overwriting what it lands on, with undo", async () => {
  const quarterPx = await openWithSpans(1);
  await addSecondTrack();
  const first = () => spansIn(0);
  const second = () => spansIn(1);
  await expect.poll(() => first().length).toBe(1);
  await expect.poll(() => second().length, { timeout: 30_000 }).toBe(1);
  const movingId = first()[0].getAttribute("data-source-span-id");
  expect(movingId).toBeTruthy();

  // Drag the first track's clip 4 quarters later onto the second track's
  // row, previewing it there before the release.
  const body = () => within(first()[0], ".source-span__body");
  body().scrollIntoView({ block: "nearest", inline: "nearest" });
  await nextFrame();
  const from = middle(body());
  const row = middle(queryAll(tracks)[1]);
  await shiftDrag(from, { x: from.x + 4 * quarterPx, y: row.y }, async () => {
    await expect.poll(() => second().length).toBe(2);
    await expect.poll(() => first().length).toBe(0);
  });

  const moved = () =>
    second().filter(
      (span) => span.getAttribute("data-source-span-id") === movingId,
    );
  await expect.poll(() => moved().length).toBe(1);
  await expect
    .poll(() => layout(moved()[0], quarterPx))
    .toEqual({ startQ: 4, durationQ: 8 });
  // The second track's own clip keeps what the moved one leaves uncovered.
  const kept = () =>
    second().filter(
      (span) => span.getAttribute("data-source-span-id") !== movingId,
    );
  await expect.poll(() => kept().length).toBe(1);
  await expect
    .poll(() => layout(kept()[0], quarterPx))
    .toEqual({ startQ: 0, durationQ: 4 });

  // One undo puts both back.
  await undo();
  await expect.poll(() => first().length).toBe(1);
  await expect.poll(() => second().length).toBe(1);
  expect(first()[0].getAttribute("data-source-span-id")).toBe(movingId);
  await expect
    .poll(() => layout(first()[0], quarterPx))
    .toEqual({ startQ: 0, durationQ: 8 });
  await expect
    .poll(() => layout(second()[0], quarterPx))
    .toEqual({ startQ: 0, durationQ: 8 });

  // Dropped outside the source tracks, it stays on its own track.
  const again = middle(body());
  await shiftDrag(again, { x: again.x + 2 * quarterPx, y: 2 });
  await expect
    .poll(() => layout(first()[0], quarterPx))
    .toEqual({ startQ: 2, durationQ: 8 });
  await expect.poll(() => second().length).toBe(1);
}, 90_000);
