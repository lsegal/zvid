import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import liveSetUrl from "../../../../test/fixtures/als/time-signature-3-4.als?url";
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

// The lock toggle on the Source Tracks header (#650): locked source tracks
// are 30% less saturated (#677), their clips can't be moved or trimmed, and the tracks can't
// be deleted or reordered. Imported Live sets open locked.

// Cmd on macOS, Ctrl elsewhere, as Playwright's ControlOrMeta.
const ROWS = ".track-row--source[data-source-track-id]";

afterEach(() => {
  vi.restoreAllMocks();
});

async function dropVideos(count: number) {
  const files = [];
  for (let index = 0; index < count; index += 1) {
    files.push(
      await fixtureFile("test-pattern.mp4", `test-pattern-${index}.mp4`),
    );
  }
  await dropFiles(
    query('[aria-label="Source track drop area"]'),
    fileTransfer(files),
  );
  await expectCount(".source-span", count);
}

function lockButton() {
  return page.elementLocator(query(".source-header__lock"));
}

function names() {
  return queryAll("[data-source-track-label-id] > span").map(
    (element) => element.textContent,
  );
}

function menuItem(name: string) {
  return page.getByRole("menuitem", { name, exact: true });
}

function firstRow() {
  return query(ROWS);
}

function span() {
  return query(`${ROWS} .source-span`);
}

function left() {
  return span().style.left;
}

function css(element: () => Element, property: string) {
  return () => getComputedStyle(element()).getPropertyValue(property);
}

// Drags `target` horizontally by `deltaPx` with Shift held, skipping snapping.
async function dragBy(target: Element, deltaPx: number) {
  target.scrollIntoView({ block: "nearest" });
  const bounds = target.getBoundingClientRect();
  const x = bounds.left + bounds.width / 2;
  const y = bounds.top + bounds.height / 2;
  await userEvent.keyboard("{Shift>}");
  await mouse.move(x, y);
  await mouse.down();
  await mouse.move(x + deltaPx, y, 8);
  await mouse.up();
  await userEvent.keyboard("{/Shift}");
}

async function expectLocked(locked: boolean) {
  await expect
    .element(lockButton())
    .toHaveAttribute("aria-pressed", String(locked));
  await expect
    .element(lockButton())
    .toHaveAccessibleName(
      locked ? "Unlock source tracks" : "Lock source tracks",
    );
  const listClasses = () => [...query(".source-track-list").classList];
  if (locked) {
    await expect.poll(listClasses).toContain("source-tracks--locked");
  } else {
    await expect.poll(listClasses).not.toContain("source-tracks--locked");
  }
}

test("locking freezes source clips and tracks until unlocked, with undo", async () => {
  await renderApp();
  await dropVideos(1);
  await expectCount(ROWS, 1);

  // Media imports start unlocked.
  await expectLocked(false);
  await expectCount(`${ROWS} .source-span .source-span__handle`, 2);

  await lockButton().click();
  await expectLocked(true);
  await expect
    .poll(() => [...span().classList])
    .toContain("source-span--locked");
  await expect.poll(css(span, "cursor")).toBe("default");
  await expectCount(`${ROWS} .source-span .source-span__handle`, 0);
  // Locked clips and labels are desaturated, not gray, dimmed or faded.
  const labelName = () => query(`${ROWS} [data-source-track-label-id]`);
  const stripe = () => query(`${ROWS} .track-label__stripe`);
  await expect.poll(css(span, "filter")).toBe("saturate(0.7)");
  await expect.poll(css(span, "opacity")).toBe("1");
  for (const part of [labelName, stripe]) {
    await expect.poll(css(part, "filter")).toBe("saturate(0.7)");
    await expect.poll(css(part, "opacity")).toBe("1");
  }

  // Dragging a locked clip changes nothing.
  const startLeft = left();
  const width = span().getBoundingClientRect().width;
  await dragBy(query(`${ROWS} .source-span__body`), width / 2);
  expect(left()).toBe(startLeft);
  // Selecting still works.
  await userEvent.click(query(`${ROWS} .source-span__body`));
  await expect
    .poll(() => [...span().classList])
    .toContain("source-span--selected");
  await expect.poll(css(span, "filter")).toBe("saturate(0.7)");

  // Undo unlocks; redo locks again.
  await userEvent.keyboard(`{${MOD}>}z{/${MOD}}`);
  await expectLocked(false);
  await userEvent.keyboard(`{${MOD}>}{Shift>}z{/Shift}{/${MOD}}`);
  await expectLocked(true);

  // The grip and the menu's Delete and Move are disabled; Duplicate is not.
  const grip = () =>
    page.elementLocator(query(`${ROWS} [data-source-track-grip]`));
  await expect.element(grip()).toBeDisabled();
  await expect
    .element(grip())
    .toHaveAttribute("title", "Source tracks are locked");
  const label = () => query(`${ROWS} .track-label--source`);
  await userEvent.click(label(), { button: "right" });
  await expect.element(menuItem("Delete")).toBeDisabled();
  await expect
    .element(menuItem("Delete"))
    .toHaveAttribute("title", "Source tracks are locked");
  await menuItem("Duplicate").click();
  await expect.poll(names).toEqual(["test-pattern-0", "test-pattern-0 copy"]);
  await userEvent.click(label(), { button: "right" });
  await expect.element(menuItem("Move down")).toBeDisabled();
  await expect
    .element(menuItem("Move down"))
    .toHaveAttribute("title", "Source tracks are locked");
  await userEvent.keyboard("{Escape}");
  await expect.element(menuItem("Move down")).not.toBeInTheDocument();

  // The section can still collapse while locked, and the lock stays shown.
  await userEvent.click(query(".source-header__toggle"));
  await expectCount(ROWS, 0);
  await expect.element(lockButton()).toBeVisible();
  await expect.element(lockButton()).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(query(".source-header__toggle"));
  await expectCount(ROWS, 2);

  // Unlocking re-enables moving, trimming and reordering.
  await lockButton().click();
  await expectLocked(false);
  await expect.poll(css(span, "filter")).toBe("none");
  await expect.poll(css(labelName, "filter")).toBe("none");
  await expect.poll(css(stripe, "filter")).toBe("none");
  await expect
    .poll(() => firstRow().querySelectorAll(".source-span__handle").length)
    .toBe(2);
  await dragBy(query(`${ROWS} .source-span__body`), width / 2);
  await expect.poll(left).not.toBe(startLeft);
  await expect.element(grip()).toBeEnabled();
  await userEvent.click(label(), { button: "right" });
  await menuItem("Move down").click();
  await expect.poll(names).toEqual(["test-pattern-0 copy", "test-pattern-0"]);
}, 90_000);

test("an imported Live set opens with its source tracks locked", async () => {
  await renderApp();
  const bytes = await (await fetch(liveSetUrl)).arrayBuffer();
  const file = new File([bytes], "time-signature-3-4.als", {
    type: "application/octet-stream",
  });
  // The web harness opens a session through a hidden file input; answer its
  // chooser with the Live set, as Playwright's filechooser does.
  const click = HTMLInputElement.prototype.click;
  vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
    this: HTMLInputElement,
  ) {
    if (this.type !== "file") {
      click.call(this);
      return;
    }
    this.files = fileTransfer([file]).files;
    this.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Open", exact: true }).click();
  await page.getByRole("menuitem", { name: "Session…", exact: true }).click();

  await expect
    .poll(() => document.querySelector(ROWS), { timeout: 30_000 })
    .toBeTruthy();
  await expect.element(page.elementLocator(firstRow())).toBeVisible();
  await expectLocked(true);
}, 60_000);
