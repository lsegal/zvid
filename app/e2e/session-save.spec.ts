import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { writeProjectArchive } from "../src/project-archive.ts";

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

test("File ▸ Export Project… downloads the session as a .zvd", async ({
  page,
}) => {
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await page.goto("/");
  await dropVideoIntoNewSourceTrack(page);

  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Export Project…", exact: true })
    .click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.zvd$/);
  const path = await download.path();
  const session = JSON.parse(await readFile(path, "utf8"));
  expect(session.tracks).toHaveLength(1);
  expect(session.clips).toHaveLength(1);
  expect(session.clips[0].filePath).toContain("test-pattern.mp4");
  await expect(page.getByText(/^Exported .*\.zvd\.$/)).toBeVisible();
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

  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Export Project…", exact: true })
    .click();
  const download = await downloadPromise;
  const saved = await readFile(await download.path(), "utf8");
  const session = JSON.parse(saved);
  expect(session.fills).toHaveLength(1);
  expect(session.fills[0].mainTrackId).toBe("1");
  expect(
    session.mainTracks.find((track: { id: string }) => track.id === "1"),
  ).toMatchObject({ fxEnabled: false });
  await expect(page.getByText(/^Exported .*\.zvd\.$/)).toBeVisible();

  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page
    .getByRole("menuitem", { name: "Open Session", exact: true })
    .click();
  const chooser = await chooserPromise;
  // Export still writes plain JSON, which a .zvd no longer opens as, so the
  // session is reopened from a project archive holding it.
  const archive = await writeProjectArchive({ project: session, media: [] });
  await chooser.setFiles({
    name: "saved.zvd",
    mimeType: "application/gzip",
    buffer: Buffer.from(await archive.arrayBuffer()),
  });

  await expect(page.getByText("saved.zvd").first()).toBeVisible();
  await expect(lane.locator(".clip-card--fill")).toHaveCount(1);
  await header.click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Enable FX", exact: true }),
  ).toBeVisible();
});
