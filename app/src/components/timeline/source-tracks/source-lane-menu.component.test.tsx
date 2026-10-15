import { beforeEach, expect, test } from "vitest";
import { type Locator, page, userEvent } from "vitest/browser";
import {
  dropFiles,
  expectCount,
  fileTransfer,
  fixtureFile,
  MOD,
  mouse,
  nextFrame,
  pressMod,
  query,
  queryAll,
  renderApp,
} from "../../../component-test/app.tsx";
import { setViewport } from "../../../component-test/viewport.ts";

// Empty space in a source track's timeline row has the layer lane menu's
// entries (#960): Paste goes into the track, and the entries that need a
// clip act on the track's selected source clip. A four-second test pattern
// at 120 BPM spans eight quarters.

const TIMEOUT = 60_000;

async function dropVideoIntoNewSourceTrack() {
  await dropFiles(
    query('[data-source-track-drop-target="new-track"]'),
    fileTransfer([await fixtureFile("test-pattern.mp4")]),
  );
  await expectCount(".source-span", 1);
}

function lane(id: string) {
  return query(`[data-timeline-lane-id="${id}"]`);
}

function firstSpan() {
  return query(".source-span");
}

function sourceLane() {
  return query(".track-row__content--source");
}

function menu() {
  return page.getByRole("menu", { name: "Source track timeline actions" });
}

function menuItem(name: string | RegExp) {
  return page.getByRole("menuitem", { name });
}

// Each span's left edge, in timeline pixels.
function lefts() {
  return queryAll(".source-span")
    .map((element) => Number.parseFloat(element.style.left))
    .sort((a, b) => a - b);
}

// Waits two frames, so a scroll's event fires before the next action.
function settle() {
  return nextFrame().then(nextFrame);
}

async function click(x: number, y: number, button: "left" | "right" = "left") {
  await mouse.move(x, y);
  await mouse.down(button);
  await mouse.up(button);
}

// Right-clicks the source track `offsetX` pixels past the first span's
// right edge, in empty space.
async function rightClickEmpty(offsetX: number) {
  const span = firstSpan();
  span.scrollIntoView({ block: "nearest", inline: "nearest" });
  await settle();
  const spanBox = span.getBoundingClientRect();
  const laneBox = sourceLane().getBoundingClientRect();
  await click(
    spanBox.x + spanBox.width + offsetX,
    laneBox.y + laneBox.height / 2,
    "right",
  );
  await expect.element(menu()).toBeVisible();
}

// A click on empty Layer 1 `offsetX` pixels past the span's right edge
// seeks there.
async function seekPast(span: Element, offsetX: number) {
  const spanBox = span.getBoundingClientRect();
  const laneBox = lane("1").getBoundingClientRect();
  await click(spanBox.x + spanBox.width + offsetX, laneBox.y + 20);
}

function disabled(item: Locator) {
  return expect.element(item).toHaveAttribute("aria-disabled", "true");
}

function enabled(item: Locator) {
  return expect.element(item).not.toHaveAttribute("aria-disabled", "true");
}

function expectSelected(element: () => Element, className: string) {
  return expect.poll(() => element().classList.contains(className)).toBe(true);
}

beforeEach(async () => {
  await setViewport({ width: 1600, height: 1200 });
  await renderApp();
  await expect.element(page.elementLocator(lane("1"))).toBeVisible();
  await dropVideoIntoNewSourceTrack();
});

test("lists the layer lane menu's entries and pastes a copied source clip", {
  timeout: TIMEOUT,
}, async () => {
  await userEvent.click(firstSpan());
  await pressMod("c");
  const [left] = lefts();
  const width = firstSpan().getBoundingClientRect().width;
  await seekPast(firstSpan(), 100);

  await rightClickEmpty(200);
  const labels = menu()
    .getByRole("menuitem")
    .elements()
    .map((element) => element.textContent ?? "");
  expect(
    labels.map((label) => label.replace(/(Ctrl|Cmd|⌘).*|Del$/, "")),
  ).toEqual([
    "Jump to start",
    "Cut",
    "Copy",
    "Paste",
    "Duplicate",
    "Split at playhead",
    "Delete",
    "Add MIDI Clip",
  ]);
  await enabled(menuItem(/^Paste/));

  await menuItem(/^Paste/).click();
  await expectCount(".source-span", 2);
  const pasted = lefts();
  expect(pasted[0]).toBeCloseTo(left, 0);
  expect(pasted[1]).toBeCloseTo(left + width + 100, -1);

  // Undo takes the paste back in one step.
  await pressMod("z");
  await expectCount(".source-span", 1);
});

test("without a selected source clip, only Paste is available", {
  timeout: TIMEOUT,
}, async () => {
  await rightClickEmpty(200);
  for (const name of [
    /^Jump to start/,
    /^Cut/,
    /^Copy/,
    /^Duplicate/,
    /^Split at playhead/,
    /^Delete/,
  ]) {
    await disabled(menuItem(name));
  }
  // Nothing has been copied yet.
  await disabled(menuItem(/^Paste/));
});

test("acts on the track's selected source clip", {
  timeout: TIMEOUT,
}, async () => {
  await userEvent.click(firstSpan());
  await expectSelected(firstSpan, "source-span--selected");

  await rightClickEmpty(200);
  await menuItem(/^Duplicate/).click();
  await expectCount(".source-span", 2);

  // Duplicate selects the copy, which Delete then removes.
  await rightClickEmpty(600);
  await menuItem(/^Delete/).click();
  await expectCount(".source-span", 1);
});

test("grays out Paste while the clipboard holds layer content", {
  timeout: TIMEOUT,
}, async () => {
  await userEvent.click(query('[data-layer-header-id="1"]'), {
    button: "right",
  });
  await menuItem("Insert text at playhead").click();
  const clip = () => query('[data-timeline-lane-id="1"] .clip-card');
  await expectCount('[data-timeline-lane-id="1"] .clip-card', 1);
  // Inserting the clip selects it.
  await expectSelected(clip, "clip-card--selected");
  await pressMod("c");

  await rightClickEmpty(200);
  await disabled(menuItem(/^Paste/));
});

test("respects the source track lock", { timeout: TIMEOUT }, async () => {
  await userEvent.click(firstSpan());
  await pressMod("c");
  await page.getByRole("button", { name: "Lock source tracks" }).click();

  await rightClickEmpty(200);
  for (const name of [
    /^Cut/,
    /^Paste/,
    /^Duplicate/,
    /^Delete/,
    /^Add MIDI Clip/,
  ]) {
    await disabled(menuItem(name));
  }
  await enabled(menuItem(/^Copy/));
});

test("the context-menu key opens it on the selected source clip's track", {
  timeout: TIMEOUT,
}, async () => {
  await userEvent.click(firstSpan());
  await expectSelected(firstSpan, "source-span--selected");
  (document.activeElement as HTMLElement | null)?.blur();

  // Chromium turns Shift+F10 into a contextmenu event on Linux and Windows
  // only; macOS has just the menu key.
  await userEvent.keyboard(
    MOD === "Meta" ? "{ContextMenu}" : "{Shift>}{F10}{/Shift}",
  );
  await expect.element(menu()).toBeVisible();
  await expect.element(menu()).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  // Hidden: gone, or no longer rendered visibly.
  await expect
    .poll(() => {
      const element = menu().query();
      return !element?.checkVisibility();
    })
    .toBe(true);

  await userEvent.keyboard("{ContextMenu}");
  await expect.element(menu()).toBeVisible();
  await menuItem(/^Duplicate/).click();
  await expectCount(".source-span", 2);
});
