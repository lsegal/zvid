import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// The lock toggle on the Source Tracks header (#650): locked source tracks
// are 30% less saturated (#677), their clips can't be moved or trimmed, and the tracks can't
// be deleted or reordered. Imported Live sets open locked.
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);
const LIVE_SET = new URL(
  "../test/fixtures/als/time-signature-3-4.als",
  import.meta.url,
);

async function dropVideos(page: Page, count: number) {
  const base64 = (await readFile(VIDEO)).toString("base64");
  const dataTransfer = await page.evaluateHandle(
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
  const target = '[aria-label="Source track drop area"]';
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(target, type, { dataTransfer });
  }
  await expect(page.locator(".source-span")).toHaveCount(count, {
    timeout: 30_000,
  });
}

function lockButton(page: Page) {
  return page.locator(".source-header__lock");
}

function list(page: Page) {
  return page.locator(".source-track-list");
}

function rows(page: Page) {
  return page.locator(".track-row--source[data-source-track-id]");
}

function names(page: Page) {
  return page.locator("[data-source-track-label-id] > span");
}

function menuItem(page: Page, name: string) {
  return page.getByRole("menuitem", { name, exact: true });
}

async function left(span: Locator) {
  return span.evaluate((element) => (element as HTMLElement).style.left);
}

// Drags `target` horizontally by `deltaPx` with Shift held, skipping snapping.
async function dragBy(page: Page, target: Locator, deltaPx: number) {
  await target.scrollIntoViewIfNeeded();
  const bounds = await target.boundingBox();
  if (!bounds) {
    throw new Error("Not visible");
  }
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.keyboard.down("Shift");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + deltaPx, y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
}

async function expectLocked(page: Page, locked: boolean) {
  await expect(lockButton(page)).toHaveAttribute(
    "aria-pressed",
    String(locked),
  );
  await expect(lockButton(page)).toHaveAccessibleName(
    locked ? "Unlock source tracks" : "Lock source tracks",
  );
  if (locked) {
    await expect(list(page)).toHaveClass(/source-tracks--locked/);
  } else {
    await expect(list(page)).not.toHaveClass(/source-tracks--locked/);
  }
}

test("locking freezes source clips and tracks until unlocked, with undo", async ({
  page,
}) => {
  await page.goto("/");
  await dropVideos(page, 1);
  await expect(rows(page)).toHaveCount(1);

  // Media imports start unlocked.
  await expectLocked(page, false);
  const span = rows(page).first().locator(".source-span");
  await expect(span.locator(".source-span__handle")).toHaveCount(2);

  await lockButton(page).click();
  await expectLocked(page, true);
  await expect(span).toHaveClass(/source-span--locked/);
  await expect(span).toHaveCSS("cursor", "default");
  await expect(span.locator(".source-span__handle")).toHaveCount(0);
  // Locked clips and labels are desaturated, not gray, dimmed or faded.
  const labelName = rows(page).first().locator("[data-source-track-label-id]");
  const stripe = rows(page).first().locator(".track-label__stripe");
  await expect(span).toHaveCSS("filter", "saturate(0.7)");
  await expect(span).toHaveCSS("opacity", "1");
  for (const part of [labelName, stripe]) {
    await expect(part).toHaveCSS("filter", "saturate(0.7)");
    await expect(part).toHaveCSS("opacity", "1");
  }

  // Dragging a locked clip changes nothing.
  const startLeft = await left(span);
  const width = (await span.boundingBox())?.width ?? 0;
  await dragBy(page, span.locator(".source-span__body"), width / 2);
  expect(await left(span)).toBe(startLeft);
  // Selecting still works.
  await span.locator(".source-span__body").click();
  await expect(span).toHaveClass(/source-span--selected/);
  await expect(span).toHaveCSS("filter", "saturate(0.7)");

  // Undo unlocks; redo locks again.
  await page.keyboard.press("ControlOrMeta+z");
  await expectLocked(page, false);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expectLocked(page, true);

  // The grip and the menu's Delete and Move are disabled; Duplicate is not.
  const grip = rows(page).first().locator("[data-source-track-grip]");
  await expect(grip).toBeDisabled();
  await expect(grip).toHaveAttribute("title", "Source tracks are locked");
  const label = rows(page).first().locator(".track-label--source");
  await label.click({ button: "right" });
  await expect(menuItem(page, "Delete")).toBeDisabled();
  await expect(menuItem(page, "Delete")).toHaveAttribute(
    "title",
    "Source tracks are locked",
  );
  await menuItem(page, "Duplicate").click();
  await expect(names(page)).toHaveText([
    "test-pattern-0",
    "test-pattern-0 copy",
  ]);
  await label.click({ button: "right" });
  await expect(menuItem(page, "Move down")).toBeDisabled();
  await expect(menuItem(page, "Move down")).toHaveAttribute(
    "title",
    "Source tracks are locked",
  );
  await page.keyboard.press("Escape");

  // The section can still collapse while locked, and the lock stays shown.
  await page.locator(".source-header__toggle").click();
  await expect(rows(page)).toHaveCount(0);
  await expect(lockButton(page)).toBeVisible();
  await expect(lockButton(page)).toHaveAttribute("aria-pressed", "true");
  await page.locator(".source-header__toggle").click();

  // Unlocking re-enables moving, trimming and reordering.
  await lockButton(page).click();
  await expectLocked(page, false);
  await expect(span).toHaveCSS("filter", "none");
  await expect(labelName).toHaveCSS("filter", "none");
  await expect(stripe).toHaveCSS("filter", "none");
  await expect(span.locator(".source-span__handle")).toHaveCount(2);
  await dragBy(page, span.locator(".source-span__body"), width / 2);
  await expect.poll(() => left(span)).not.toBe(startLeft);
  await expect(grip).toBeEnabled();
  await label.click({ button: "right" });
  await menuItem(page, "Move down").click();
  await expect(names(page)).toHaveText([
    "test-pattern-0 copy",
    "test-pattern-0",
  ]);
});

test("an imported Live set opens with its source tracks locked", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("menuitem", { name: "Open Session", exact: true })
    .click();
  await (await chooser).setFiles({
    name: "time-signature-3-4.als",
    mimeType: "application/octet-stream",
    buffer: await readFile(LIVE_SET),
  });

  await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });
  await expectLocked(page, true);
});
