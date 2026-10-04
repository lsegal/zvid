import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// The Sessions library: File ▸ Save (Mod+S) keeps the session in the
// Sessions tab of the drawer left of the timeline, where it outlives Close
// and reloads, reopens with a click and renames, duplicates or deletes from
// its context menu.
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

async function dropVideoIntoNewSourceTrack(page: Page) {
  const base64 = (await readFile(VIDEO)).toString("base64");
  const dataTransfer = await page.evaluateHandle((data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([bytes], "test-pattern.mp4", { type: "video/mp4" }),
    );
    return transfer;
  }, base64);
  const target = '[data-source-track-drop-target="new-track"]';
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(target, type, { dataTransfer });
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
}

function drawer(page: Page) {
  return page.getByRole("complementary", { name: "Sessions" });
}

function entries(page: Page) {
  return drawer(page)
    .getByRole("list", { name: "Sessions" })
    .getByRole("button");
}

function entry(page: Page, name: string) {
  return entries(page).filter({ hasText: name });
}

async function saveNewSession(page: Page) {
  await page.goto("/");
  await dropVideoIntoNewSourceTrack(page);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(
    page.getByText("Saved Untitled Session to Sessions."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await expect(entries(page)).toHaveCount(1);
}

async function openEntryMenu(page: Page, name: string, item: string) {
  await entry(page, name).click({ button: "right" });
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

test("the Sessions tab sits left of Media and switches the drawer", async ({
  page,
}) => {
  await page.goto("/");
  const toolbar = page.getByRole("group", { name: "Media drawer" });
  await expect(toolbar.getByRole("button")).toHaveText([
    "Sessions",
    "Media",
    "Record",
  ]);

  const sessions = toolbar.getByRole("button", { name: "Sessions" });
  await sessions.click();
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page).getByText("No sessions yet")).toBeVisible();

  await toolbar.getByRole("button", { name: "Media" }).click();
  await expect(
    page.getByRole("complementary", { name: "Media" }),
  ).toBeVisible();

  await sessions.click();
  await expect(drawer(page)).toBeVisible();
  await sessions.click();
  await expect(drawer(page)).toBeHidden();
});

test("a saved session survives Close and reloads and reopens", async ({
  page,
}) => {
  await saveNewSession(page);
  const saved = entry(page, "Untitled Session");
  await expect(saved).toHaveAttribute("aria-current", "true");
  // Dropped media lands in a source track, not the arrangement.
  await expect(saved).toContainText("0 clips");

  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Close Session" }).click();
  await expect(page.locator(".source-span")).toHaveCount(0);
  await expect(saved).not.toHaveAttribute("aria-current", "true");

  // The drawer stays open on the Sessions tab across the reload.
  await page.reload();
  await expect(entries(page)).toHaveCount(1);

  await entry(page, "Untitled Session").click();
  await expect(page.getByText("Opened Untitled Session.")).toBeVisible();
  await expect(page.locator(".source-span")).toHaveCount(1);
  await expect(entry(page, "Untitled Session")).toHaveAttribute(
    "aria-current",
    "true",
  );
});

test("saving again updates the same entry", async ({ page }) => {
  await saveNewSession(page);
  await page.getByRole("button", { name: /^Snap (On|Off)$/ }).click();
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Save/ }).click();
  await expect(
    page.getByText("Saved Untitled Session to Sessions."),
  ).toBeVisible();
  await expect(entries(page)).toHaveCount(1);
});

test("entries rename, duplicate and delete from their context menu", async ({
  page,
}) => {
  await saveNewSession(page);

  await openEntryMenu(page, "Untitled Session", "Rename…");
  const name = drawer(page).getByRole("textbox", { name: "Session name" });
  await name.fill("Demo");
  await name.press("Enter");
  await expect(entry(page, "Demo")).toHaveCount(1);

  await openEntryMenu(page, "Demo", "Duplicate");
  await expect(entry(page, "Demo copy")).toHaveCount(1);
  await expect(entries(page)).toHaveCount(2);

  await openEntryMenu(page, "Demo copy", "Delete…");
  const confirm = page.getByRole("dialog", { name: "Delete Demo copy?" });
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(entries(page)).toHaveCount(1);
  await expect(entry(page, "Demo copy")).toHaveCount(0);

  // The drawer stays open on the Sessions tab across the reload.
  await page.reload();
  await expect(entries(page)).toHaveText([/^Demo/]);
});

test("opening an entry over unsaved changes asks first", async ({ page }) => {
  await saveNewSession(page);
  await openEntryMenu(page, "Untitled Session", "Rename…");
  const name = drawer(page).getByRole("textbox", { name: "Session name" });
  await name.fill("First");
  await name.press("Enter");
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Close Session" }).click();
  await dropVideoIntoNewSourceTrack(page);

  await entry(page, "First").click();
  const prompt = page.getByRole("dialog", { name: /^Save changes to/ });
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Cancel" }).click();
  await expect(prompt).toBeHidden();
  await expect(page.getByText("Opened First.")).toHaveCount(0);

  await entry(page, "First").click();
  await prompt.getByRole("button", { name: "Save and Open" }).click();
  await expect(page.getByText("Opened First.")).toBeVisible();
  // The unsaved session was saved as its own entry first.
  await expect(entries(page)).toHaveCount(2);
  await expect(entry(page, "Untitled Session")).toHaveCount(1);
});

test("opening a session file adds it to Sessions", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await expect(drawer(page).getByText("No sessions yet")).toBeVisible();

  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page
    .getByRole("menuitem", { name: "Open Session", exact: true })
    .click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "Opened Set.lvp",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ bpm: 120, tracks: [], clips: [] })),
  });

  const opened = entry(page, "Opened Set");
  await expect(opened).toHaveCount(1);
  await expect(opened).toHaveAttribute("aria-current", "true");
});
