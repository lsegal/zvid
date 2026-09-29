import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// File ▸ Save in the browser build: a session with no writable path prompts
// for a location, which is a download where the save picker is missing.
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

test("File ▸ Save downloads the session as an .lvp", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await page.goto("/");
  await dropVideoIntoNewSourceTrack(page);

  await page.getByRole("button", { name: "File", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Save", exact: true }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.lvp$/);
  const path = await download.path();
  const session = JSON.parse(await readFile(path, "utf8"));
  expect(session.tracks).toHaveLength(1);
  expect(session.clips).toHaveLength(1);
  expect(session.clips[0].filePath).toContain("test-pattern.mp4");
  await expect(page.getByText(/^Saved .*\.lvp\.$/)).toBeVisible();
});
