import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import {
  readProjectArchive,
  writeProjectArchive,
} from "../src/project-archive.ts";
import type { LvpSession } from "../src/session.ts";

// File ▸ Open ▸ Session… opens a `.zvd` project archive with the media bundled
// under its `media/` folder, so a project exported with its media opens with
// nothing offline.
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

// A session with one clip of the test pattern, exported with its media, so
// the clip links `media/<name>` inside the archive.
async function exportedSession(page: Page) {
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await page.goto("/");
  await dropVideoIntoNewSourceTrack(page);
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export", exact: true }).click();
  await page.getByRole("menuitem", { name: "Project…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export Project" });
  await dialog
    .getByRole("checkbox", { name: "Include media files" })
    .setChecked(true);
  const downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const bytes = await readFile(await (await downloading).path());
  const { project: session } = await readProjectArchive(new Uint8Array(bytes));
  expect(session.clips?.map((clip) => clip.filePath)).toEqual([
    "media/test-pattern.mp4",
  ]);
  return { session, bytes };
}

// File ▸ New Session, discarding the session the archive was built from.
async function startNewSession(page: Page) {
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "New Session" }).click();
  const prompt = page.getByRole("dialog", {
    name: "Save changes to this session?",
  });
  await expect(prompt.or(page.getByText("No source media yet"))).toBeVisible();
  if (await prompt.isVisible()) {
    await prompt.getByRole("button", { name: "Don't Save" }).click();
  }
  await expect(page.locator(".source-span")).toHaveCount(0);
}

async function openSessionFile(page: Page, name: string, buffer: Buffer) {
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  const choosing = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Open", exact: true }).click();
  await page.getByRole("menuitem", { name: "Session…", exact: true }).click();
  await (await choosing).setFiles({
    name,
    mimeType: "application/gzip",
    buffer,
  });
}

// The session in an archive without its media.
async function bareArchive(project: LvpSession) {
  const blob = await writeProjectArchive({ project, media: [] });
  return Buffer.from(await blob.arrayBuffer());
}

function mediaItems(page: Page) {
  return page.getByRole("complementary", { name: "Media" }).getByRole("option");
}

test("a .zvd archive opens with its bundled media online", async ({ page }) => {
  const { bytes } = await exportedSession(page);
  await startNewSession(page);

  await openSessionFile(page, "Bundled.zvd", bytes);

  await expect(page.getByText("Bundled.zvd").first()).toBeVisible();
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Media", exact: true }).click();
  await expect(mediaItems(page)).toHaveCount(1);
  await expect(mediaItems(page).first()).toHaveAttribute(
    "data-availability",
    "ready",
    { timeout: 30_000 },
  );
  await expect(
    page.getByRole("button", { name: /offline media files?$/ }),
  ).toHaveCount(0);
});

test("a .zvd archive without media opens with its media offline", async ({
  page,
}) => {
  const { session } = await exportedSession(page);
  const buffer = await bareArchive(session);
  await startNewSession(page);

  await openSessionFile(page, "Bare.zvd", buffer);

  await expect(page.getByText("Bare.zvd").first()).toBeVisible();
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Media", exact: true }).click();
  await expect(mediaItems(page).first()).toHaveAttribute(
    "data-availability",
    "offline",
    { timeout: 30_000 },
  );
});

test("an old plain-JSON .zvd is rejected as not a project archive", async ({
  page,
}) => {
  const { session } = await exportedSession(page);
  await startNewSession(page);

  await openSessionFile(page, "Old.zvd", Buffer.from(JSON.stringify(session)));

  await expect(
    page.getByText(/Old\.zvd is not a zvid project archive\./).first(),
  ).toBeVisible();
  await expect(page.locator(".source-span")).toHaveCount(0);
});
