import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { readProjectArchive } from "../src/project-archive.ts";

// File ▸ Export Project… in the browser build prompts for a location, which is
// a download where the save picker is missing.
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

// Runs File ▸ Export Project… through its dialog and reads the downloaded
// archive.
async function exportProject(page: Page, { includeMedia = false } = {}) {
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Export Project…", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Export Project" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("checkbox", { name: "Include media files" })
    .setChecked(includeMedia);
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloadPromise;
  const bytes = await readFile(await download.path());
  return {
    download,
    bytes,
    archive: await readProjectArchive(new Uint8Array(bytes)),
  };
}

test("File ▸ Export Project… downloads the session as a .zvd archive", async ({
  page,
}) => {
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await page.goto("/");
  await dropVideoIntoNewSourceTrack(page);

  const { download, bytes, archive } = await exportProject(page);

  expect(download.suggestedFilename()).toMatch(/\.zvd$/);
  // gzip magic
  expect([...bytes.subarray(0, 2)]).toEqual([0x1f, 0x8b]);
  expect(archive.media).toEqual([]);
  const session = archive.project;
  expect(session.tracks).toHaveLength(1);
  expect(session.clips).toHaveLength(1);
  expect(session.clips?.[0]?.filePath).toContain("test-pattern.mp4");
  expect(session.clips?.[0]?.filePath).not.toMatch(/^media\//);
  await expect(page.getByText(/^Exported .*\.zvd\.$/)).toBeVisible();
});

test("File ▸ Export Project… bundles the project's media when asked", async ({
  page,
}) => {
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await page.goto("/");
  await dropVideoIntoNewSourceTrack(page);

  const { archive } = await exportProject(page, { includeMedia: true });

  expect(archive.media.map((entry) => entry.path)).toEqual([
    "media/test-pattern.mp4",
  ]);
  expect(archive.media[0]?.file.size).toBe((await readFile(VIDEO)).length);
  expect(archive.project.clips?.[0]?.filePath).toBe("media/test-pattern.mp4");
  await expect(page.getByText(/^Exported .*\.zvd\.$/)).toBeVisible();
});

test("File ▸ Export Project… Cancel exports nothing", async ({ page }) => {
  await page.goto("/");
  let downloads = 0;
  page.on("download", () => {
    downloads += 1;
  });
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Export Project…", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Export Project" });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Export canceled.")).toBeVisible();
  expect(downloads).toBe(0);
});

test("File ▸ Export Project… keeps fill clips and layer FX bypass on reopen", async ({
  page,
}) => {
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await page.goto("/");
  const lane = page.locator('[data-timeline-lane-id="1"]');
  const bounds = await lane.boundingBox();
  if (!bounds) {
    throw new Error("Lane is not visible");
  }
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + 40, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 150, y);
  await page.mouse.move(bounds.x + 260, y);
  await page.mouse.up();
  await page.mouse.click(bounds.x + 150, bounds.y + 20, { button: "right" });
  await page
    .getByRole("menu", { name: "Selection actions" })
    .getByRole("menuitem", { name: "Insert Fill Clip" })
    .click();
  await expect(lane.locator(".clip-card--fill")).toHaveCount(1);

  // The fill carries its own Color, so the layer needs an effect of its own
  // to bypass.
  const header = page.locator('[data-layer-header-id="1"]');
  await header.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add FX", exact: true }).click();
  await page.getByRole("menuitem", { name: "Colorize", exact: true }).click();
  await header.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Disable FX", exact: true }).click();

  const { bytes, archive } = await exportProject(page);
  const session = archive.project;
  expect(session.fills).toHaveLength(1);
  expect(session.fills?.[0]?.mainTrackId).toBe("1");
  expect(
    session.mainTracks?.find((track: { id: string }) => track.id === "1"),
  ).toMatchObject({ fxEnabled: false });
  await expect(page.getByText(/^Exported .*\.zvd\.$/)).toBeVisible();

  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page
    .getByRole("menuitem", { name: "Open Session", exact: true })
    .click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "saved.zvd",
    mimeType: "application/gzip",
    buffer: bytes,
  });

  await expect(page.getByText("saved.zvd").first()).toBeVisible();
  await expect(lane.locator(".clip-card--fill")).toHaveCount(1);
  await header.click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Enable FX", exact: true }),
  ).toBeVisible();
});
