import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { writeProjectArchive } from "../src/project-archive.ts";
import type { LvpSession } from "../src/session.ts";

// File ▸ Open Session opens a `.zvd` project archive with the media bundled
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

// A session with one clip of the test pattern, saved as `media/<name>` the
// way an archive with media links it.
async function exportedSession(page: Page) {
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await page.goto("/");
  await dropVideoIntoNewSourceTrack(page);
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Export Project…", exact: true })
    .click();
  const session = JSON.parse(
    await readFile(await (await downloading).path(), "utf8"),
  ) as LvpSession;
  for (const clip of session.clips ?? []) {
    clip.filePath = "media/test-pattern.mp4";
  }
  return session;
}

async function closeSession(page: Page) {
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Close Session" }).click();
  await expect(page.locator(".source-span")).toHaveCount(0);
}

async function openSessionFile(page: Page, name: string, buffer: Buffer) {
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  const choosing = page.waitForEvent("filechooser");
  await page
    .getByRole("menuitem", { name: "Open Session", exact: true })
    .click();
  await (await choosing).setFiles({
    name,
    mimeType: "application/gzip",
    buffer,
  });
}

async function archive(
  project: LvpSession,
  media: Array<{ path: string; blob: Blob }>,
) {
  const blob = await writeProjectArchive({ project, media });
  return Buffer.from(await blob.arrayBuffer());
}

function mediaItems(page: Page) {
  return page.getByRole("complementary", { name: "Media" }).getByRole("option");
}

test("a .zvd archive opens with its bundled media online", async ({ page }) => {
  const session = await exportedSession(page);
  const buffer = await archive(session, [
    { path: "media/test-pattern.mp4", blob: new Blob([await readFile(VIDEO)]) },
  ]);
  await closeSession(page);

  await openSessionFile(page, "Bundled.zvd", buffer);

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
  const session = await exportedSession(page);
  const buffer = await archive(session, []);
  await closeSession(page);

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
  const session = await exportedSession(page);
  await closeSession(page);

  await openSessionFile(page, "Old.zvd", Buffer.from(JSON.stringify(session)));

  await expect(
    page.getByText(/Old\.zvd is not a zvid project archive\./).first(),
  ).toBeVisible();
  await expect(page.locator(".source-span")).toHaveCount(0);
});
