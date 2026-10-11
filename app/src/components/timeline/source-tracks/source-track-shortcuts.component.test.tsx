import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  dropFiles,
  expectCount,
  fileTransfer,
  fixtureFile,
  MOD,
  query,
  queryAll,
  renderApp,
} from "../../../component-test/app.tsx";

// Delete, Mod+D and the context-menu key act on the selected source track
// (#660), like they do on a selected clip.

// Cmd on macOS, Ctrl elsewhere, as Playwright's ControlOrMeta.
const ROWS = ".track-row--source[data-source-track-id]";
const LAYER_CLIPS = '[data-timeline-lane-id="1"] .clip-card';

function row(index: number) {
  const element = queryAll(ROWS)[index];
  if (!element) {
    throw new Error(`missing source track ${index}`);
  }
  return element;
}

function names() {
  return queryAll("[data-source-track-label-id] > span").map(
    (element) => element.textContent,
  );
}

async function expectNames(expected: string[]) {
  await expect.poll(names).toEqual(expected);
}

function classes(selector: string | (() => Element)) {
  return () => [
    ...(typeof selector === "string" ? query(selector) : selector()).classList,
  ];
}

function menuItem(name: string) {
  return page.getByRole("menuitem", { name, exact: true });
}

async function press(key: string) {
  await userEvent.keyboard(key);
}

async function selectTrack(index: number) {
  const label = row(index).querySelector(".track-label__select") as HTMLElement;
  label.scrollIntoView({ block: "nearest" });
  await userEvent.click(label);
  await expect.poll(classes(() => row(index))).toContain("track-row--selected");
}

// One source track, "test-pattern", with a clip cut from it on Layer 1.
beforeEach(async () => {
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

test("Mod+D duplicates the selected source track, in one undo step", async () => {
  await selectTrack(0);
  await press(`{${MOD}>}d{/${MOD}}`);
  await expectNames(["test-pattern", "test-pattern copy"]);
  await expect
    .poll(() => row(1).querySelectorAll(".source-span").length)
    .toBe(1);
  await expectCount(LAYER_CLIPS, 1);
  // The selection follows the track to its duplicate.
  await expect.poll(classes(() => row(1))).toContain("track-row--selected");
  await expect.poll(classes(() => row(0))).not.toContain("track-row--selected");

  await press(`{${MOD}>}z{/${MOD}}`);
  await expectNames(["test-pattern"]);
}, 60_000);

test("Delete and Backspace delete the selected source track with its layer clips", async () => {
  await selectTrack(0);
  await press(`{${MOD}>}d{/${MOD}}`);
  await expectNames(["test-pattern", "test-pattern copy"]);

  // The copy has no layer clips of its own; the selection moves to the
  // track that takes its place.
  await press("{Delete}");
  await expectNames(["test-pattern"]);
  await expectCount(LAYER_CLIPS, 1);
  await expect.poll(classes(() => row(0))).toContain("track-row--selected");

  // The original takes its layer clip along.
  await press("{Backspace}");
  await expectCount(ROWS, 0);
  await expectCount(".source-span", 0);
  await expectCount(LAYER_CLIPS, 0);

  // Undo brings both back in one step.
  await press(`{${MOD}>}z{/${MOD}}`);
  await expectNames(["test-pattern"]);
  await expectCount(".source-span", 1);
  await expectCount(LAYER_CLIPS, 1);
}, 60_000);

test("Delete removes a selected source clip, not its source track", async () => {
  await userEvent.click(query(".source-span"));
  await expect.poll(classes(".source-span")).toContain("source-span--selected");
  await press("{Delete}");
  await expectCount(".source-span", 0);
  await expectNames(["test-pattern"]);
  // The layer clip made from it stays, showing nothing (#932).
  await expectCount(LAYER_CLIPS, 1);
  await expectCount(`${LAYER_CLIPS} .clip-card__piece`, 0);
}, 60_000);

test("a selected layer clip keeps Delete and Mod+D", async () => {
  await selectTrack(0);
  const clip = query(LAYER_CLIPS);
  clip.scrollIntoView({ block: "nearest" });
  await userEvent.click(query(`${LAYER_CLIPS} .clip-card__body`));
  await expect.poll(classes(LAYER_CLIPS)).toContain("clip-card--selected");

  await press(`{${MOD}>}d{/${MOD}}`);
  await expectCount(LAYER_CLIPS, 2);
  await expectNames(["test-pattern"]);
  await press("{Delete}");
  await expectCount(LAYER_CLIPS, 1);
  await expectNames(["test-pattern"]);
}, 60_000);

test("the context-menu key opens the selected source track's menu", async () => {
  const menu = page.getByRole("menu", { name: "Source track actions" });
  await selectTrack(0);
  (document.activeElement as HTMLElement | null)?.blur();
  // Chromium turns Shift+F10 into a contextmenu event on Linux and Windows
  // only; macOS has just the menu key.
  await press(MOD === "Meta" ? "{ContextMenu}" : "{Shift>}{F10}{/Shift}");
  await expect.element(menu).toBeVisible();
  // The menu takes focus a tick after it opens; keys before that are lost.
  await expect.element(menu).toHaveFocus();
  await press("{Escape}");
  await expect.element(menu).not.toBeInTheDocument();

  await press("{ContextMenu}");
  await expect.element(menu).toBeVisible();
  await menuItem("Duplicate").click();
  await expectNames(["test-pattern", "test-pattern copy"]);
}, 60_000);

test("while source tracks are locked, Delete does nothing and Mod+D still duplicates", async () => {
  await page.getByRole("button", { name: "Lock source tracks" }).click();
  await expect
    .element(page.getByRole("button", { name: "Unlock source tracks" }))
    .toHaveAttribute("aria-pressed", "true");
  await selectTrack(0);

  await press("{Delete}");
  await press("{Backspace}");
  await expectNames(["test-pattern"]);
  await expectCount(LAYER_CLIPS, 1);

  await press(`{${MOD}>}d{/${MOD}}`);
  await expectNames(["test-pattern", "test-pattern copy"]);
}, 60_000);
