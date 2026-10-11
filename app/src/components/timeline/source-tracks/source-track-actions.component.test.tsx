import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  dropFiles,
  expectCount,
  fileTransfer,
  fixtureFile,
  MOD,
  mouse,
  query,
  queryAll,
  renderApp,
} from "../../../component-test/app.tsx";
import { setViewport } from "../../../component-test/viewport.ts";

// Duplicating, deleting and reordering source tracks like layers (#654), from
// the label's menu and its grip, and renaming them (#663).

// Cmd on macOS, Ctrl elsewhere, as Playwright's ControlOrMeta.
const ROWS = ".track-row--source[data-source-track-id]";
const LAYER_CLIPS = '[data-timeline-lane-id="1"] .clip-card';

function rows() {
  return queryAll(ROWS);
}

function row(index: number) {
  const element = rows()[index];
  if (!element) {
    throw new Error(`missing source track ${index}`);
  }
  return element;
}

function texts(selector: string) {
  return queryAll(selector).map((element) => element.textContent);
}

function names() {
  return texts("[data-source-track-label-id] > span");
}

function keys() {
  return texts("[data-source-track-label-id] > small");
}

async function expectNames(expected: string[]) {
  await expect.poll(names).toEqual(expected);
}

function label(index: number) {
  return row(index).querySelector(".track-label--source") as HTMLElement;
}

function grip(index: number) {
  return row(index).querySelector("[data-source-track-grip]") as HTMLElement;
}

async function openMenu(index: number) {
  const target = label(index);
  target.scrollIntoView({ block: "nearest" });
  await userEvent.click(target, { button: "right" });
  const menu = page.getByRole("menu", { name: "Source track actions" });
  await expect.element(menu).toBeVisible();
  return menu;
}

function menuItem(name: string) {
  return page.getByRole("menuitem", { name, exact: true });
}

function center(element: Element) {
  element.scrollIntoView({ block: "nearest" });
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

async function undo() {
  await userEvent.keyboard(`{${MOD}>}z{/${MOD}}`);
}

// One source track, "test-pattern", with a clip cut from it on Layer 1.
beforeEach(async () => {
  // The docked Audio row footer (#809) leaves less room for rows to scroll
  // in; the default session's rows no longer all fit without scrolling.
  await setViewport({ width: 1600, height: 1200 });
  await renderApp();
  await dropFiles(
    query('[data-source-track-drop-target="new-track"]'),
    fileTransfer([await fixtureFile("test-pattern.mp4")]),
  );
  await expectCount(".source-span", 1);
  await userEvent.click(query(".source-span"), { button: "right" });
  await menuItem("Copy to layer").hover();
  await menuItem("Layer 1").click();
  await expectCount(LAYER_CLIPS, 1);
  await expectNames(["test-pattern"]);
}, 60_000);

test("Rename… renames a source track and its clips, in one undo step", async () => {
  const spanLabel = () => texts(".source-span__body > span");
  const clipLabel = () => texts(`${LAYER_CLIPS} .clip-card__text > strong`);
  await expect.poll(spanLabel).toEqual(["test-pattern"]);
  await expect.poll(clipLabel).toEqual(["test-pattern"]);
  const trackLabel = () =>
    page.elementLocator(query("[data-source-track-label-id]"));

  // Escape cancels and puts focus back on the label.
  await openMenu(0);
  await menuItem("Rename…").click();
  const input = page.getByRole("textbox", { name: "Source track name" });
  await expect.element(input).toHaveFocus();
  await expect.element(input).toHaveValue("test-pattern");
  await input.fill("Ignored");
  await userEvent.keyboard("{Escape}");
  await expect.element(input).not.toBeInTheDocument();
  await expectNames(["test-pattern"]);
  await expect.element(trackLabel()).toHaveFocus();

  // An empty name keeps the old one.
  await openMenu(0);
  await menuItem("Rename…").click();
  await input.fill("   ");
  await userEvent.keyboard("{Enter}");
  await expect.element(input).not.toBeInTheDocument();
  await expectNames(["test-pattern"]);

  // Enter saves the trimmed name on the track, its span and its layer clip.
  await openMenu(0);
  await menuItem("Rename…").click();
  await input.fill("  Wide shot ");
  await userEvent.keyboard("{Enter}");
  await expectNames(["Wide shot"]);
  await expect.poll(spanLabel).toEqual(["Wide shot"]);
  await expect.poll(clipLabel).toEqual(["Wide shot"]);
  await expect.element(trackLabel()).toHaveFocus();
  await expect
    .element(page.elementLocator(grip(0)))
    .toHaveAccessibleName("Reorder Wide shot");

  await undo();
  await expectNames(["test-pattern"]);
  await expect.poll(spanLabel).toEqual(["test-pattern"]);
  await expect.poll(clipLabel).toEqual(["test-pattern"]);
}, 60_000);

test("the menu duplicates a source track below it, spans and all", async () => {
  await openMenu(0);
  // The only track cannot move.
  await expect.element(menuItem("Move up")).toBeDisabled();
  await expect.element(menuItem("Move down")).toBeDisabled();
  await menuItem("Duplicate").click();

  await expectNames(["test-pattern", "test-pattern copy"]);
  await expect
    .poll(keys)
    .toEqual([
      expect.stringMatching(/key 1$/),
      expect.stringMatching(/key 2$/),
    ]);
  await expect
    .poll(() => row(1).querySelectorAll(".source-span").length)
    .toBe(1);
  // The layer clips stay as they were.
  await expectCount(LAYER_CLIPS, 1);
  // In a color of its own.
  const stripes = queryAll(`${ROWS} .track-label__stripe`).map(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(stripes).toHaveLength(2);
  expect(stripes[0]).not.toBe(stripes[1]);

  await undo();
  await expectNames(["test-pattern"]);
}, 60_000);

test("Move up and Move down reorder source tracks, and the keys follow", async () => {
  await openMenu(0);
  await menuItem("Duplicate").click();
  await expectNames(["test-pattern", "test-pattern copy"]);

  await openMenu(1);
  await expect.element(menuItem("Move down")).toBeDisabled();
  await menuItem("Move up").click();
  await expectNames(["test-pattern copy", "test-pattern"]);
  await expect
    .poll(keys)
    .toEqual([
      expect.stringMatching(/key 1$/),
      expect.stringMatching(/key 2$/),
    ]);

  await openMenu(0);
  await menuItem("Move down").click();
  await expectNames(["test-pattern", "test-pattern copy"]);

  await undo();
  await expectNames(["test-pattern copy", "test-pattern"]);
}, 60_000);

test("Delete removes a source track with its spans and the layer clips cut from them", async () => {
  await openMenu(0);
  await menuItem("Duplicate").click();
  await expectNames(["test-pattern", "test-pattern copy"]);

  // The copy has no layer clips of its own.
  await openMenu(1);
  await menuItem("Delete").click();
  await expectNames(["test-pattern"]);
  await expectCount(LAYER_CLIPS, 1);

  // The original takes its layer clip along, and the last track can go.
  await openMenu(0);
  await menuItem("Delete").click();
  await expectCount(ROWS, 0);
  await expectCount(".source-span", 0);
  await expectCount(LAYER_CLIPS, 0);

  // Undo brings both back in one step.
  await undo();
  await expectNames(["test-pattern"]);
  await expectCount(".source-span", 1);
  await expectCount(LAYER_CLIPS, 1);
}, 60_000);

test("dragging a source track's grip reorders it, in one undo step", async () => {
  await openMenu(0);
  await menuItem("Duplicate").click();
  await expectNames(["test-pattern", "test-pattern copy"]);
  await expect
    .element(page.elementLocator(grip(1)))
    .toHaveAccessibleName("Reorder test-pattern copy");

  // Scrolled to the end, so the grip is clear of the bottom edge, where a
  // drag scrolls the timeline under the pointer.
  const scroll = query(".timeline-scroll");
  scroll.scrollTop = scroll.scrollHeight;
  const from = center(grip(1));
  const to = center(label(0));
  await mouse.move(from.x, from.y);
  await mouse.down();
  await mouse.move(from.x, from.y - 10, 2);
  await expect.poll(() => [...row(1).classList]).toContain("track-row--lifted");
  await mouse.move(from.x, to.y - 20, 8);
  await expect
    .poll(() => query(".source-track-list .layer-reorder-status").textContent)
    .toBe("test-pattern copy, position 1 of 2");
  await expect
    .element(
      page.elementLocator(query(".source-track-list .layer-drop-indicator")),
    )
    .toBeVisible();
  await mouse.up();

  await expectNames(["test-pattern copy", "test-pattern"]);
  await expectCount(".track-row--lifted", 0);

  await undo();
  await expectNames(["test-pattern", "test-pattern copy"]);
}, 60_000);

test("a source track's grip picks it up and drops it from the keyboard", async () => {
  await openMenu(0);
  await menuItem("Duplicate").click();
  await expectNames(["test-pattern", "test-pattern copy"]);

  const status = () =>
    query(".source-track-list .layer-reorder-status").textContent;
  grip(0).focus();
  await userEvent.keyboard("{Enter}");
  await expect
    .poll(status)
    .toContain("Picked up test-pattern, position 1 of 2");
  await userEvent.keyboard("{ArrowDown}");
  await expect.poll(status).toBe("test-pattern, position 2 of 2");
  await userEvent.keyboard("{Enter}");
  await expect.poll(status).toBe("Dropped test-pattern, position 2 of 2");
  await expectNames(["test-pattern copy", "test-pattern"]);

  // Escape puts it back.
  grip(0).focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.keyboard("{ArrowDown}");
  await userEvent.keyboard("{Escape}");
  await expect.poll(status).toBe("Canceled moving test-pattern copy");
  await expectNames(["test-pattern copy", "test-pattern"]);
}, 60_000);
