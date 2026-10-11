import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import {
  dropFiles,
  expectCount,
  fileTransfer,
  fixtureFile,
  mouse,
  query,
  renderApp,
} from "../../../component-test/app.tsx";
import { setViewport } from "../../../component-test/viewport.ts";

// The playhead line spans the whole timeline canvas and is drawn across the
// Source Tracks group header row, like the lanes above and rows below (#968).

async function open() {
  await setViewport({ width: 1600, height: 1200 });
  return renderApp();
}

async function dropVideoIntoNewSourceTrack() {
  await dropFiles(
    query('[data-source-track-drop-target="new-track"]'),
    fileTransfer([await fixtureFile("test-pattern.mp4")]),
  );
  await expectCount(".source-span", 1, 30_000);
}

// Seeks by clicking empty space in Layer 1's lane, `offset` px into it.
async function seek(offset: number) {
  const lane = query('[data-timeline-lane-id="1"]');
  lane.scrollIntoView({ block: "nearest", inline: "nearest" });
  const bounds = lane.getBoundingClientRect();
  const lineX = () => query(".timeline-playhead").getBoundingClientRect().left;
  const before = lineX();
  await mouse.move(bounds.x + offset, bounds.y + 20);
  await mouse.down();
  await mouse.up();
  // Wait for the playhead line to move to the click.
  await expect.poll(lineX).not.toBe(before);
}

// What paints topmost at the playhead line's x, in the middle of `selector`.
// The line ignores pointer events, so turn them on to let elementFromPoint
// see it wherever it is on top.
async function topmostAtPlayhead(selector: string) {
  query(selector).scrollIntoView({ block: "center" });
  const style = document.createElement("style");
  style.textContent = ".timeline-playhead { pointer-events: auto !important; }";
  document.head.append(style);
  try {
    const line = query(".timeline-playhead");
    const element = query(selector);
    const lineBox = line.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    const x = lineBox.left + lineBox.width / 2;
    if (x < box.left || x > box.right) {
      throw new Error(`playhead x ${x} is outside ${selector}`);
    }
    const hit = document.elementFromPoint(x, box.top + box.height / 2);
    return {
      playhead: Boolean(hit?.closest(".timeline-playhead")),
      header: Boolean(hit?.closest(".source-header__content")),
    };
  } finally {
    style.remove();
  }
}

test("the playhead line shows over the empty source header", async () => {
  await open();
  await expect.element(query(".source-header--empty")).toBeVisible();
  await seek(300);

  expect(await topmostAtPlayhead(".source-header__content")).toEqual({
    playhead: true,
    header: false,
  });
}, 60_000);

test("the playhead line shows over the source header with tracks", async () => {
  await open();
  await expect.element(query(".source-header")).toBeVisible();
  await dropVideoIntoNewSourceTrack();
  await expectCount(".source-header--empty", 0);
  await seek(300);

  expect(await topmostAtPlayhead(".source-header__content")).toEqual({
    playhead: true,
    header: false,
  });
  expect(await topmostAtPlayhead(".track-row__content--source")).toMatchObject({
    playhead: true,
  });

  await userEvent.click(query(".source-header__toggle"));
  await expectCount(".source-header--collapsed", 1);
  await expect.element(query(".source-header--collapsed")).toBeVisible();
  expect(await topmostAtPlayhead(".source-header__content")).toEqual({
    playhead: true,
    header: false,
  });
}, 60_000);

test("the source header drop target keeps its highlight", async () => {
  await open();
  const content = query(".source-header__content");
  await expect.element(content).toBeVisible();
  const base = getComputedStyle(content).backgroundImage;
  query(".source-header").classList.add("is-drop-target");
  const highlighted = getComputedStyle(content).backgroundImage;
  expect(highlighted).not.toBe(base);
  expect(highlighted).toContain("rgba(124, 161, 255, 0.14)");
}, 60_000);
