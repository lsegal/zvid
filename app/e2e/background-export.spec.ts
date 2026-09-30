import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// Exports run in the background: the Export dialog hides without stopping
// the export, the status bar shows its progress and reopens the dialog, and
// the editor stays usable meanwhile, while the export renders the session as
// it was when it started.
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

test.use({ viewport: { width: 1600, height: 1200 } });

test.beforeEach(async ({ page }) => {
  // Without the save picker the web harness saves through a download.
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await addVideoClip(page);
});

async function addVideoClip(page: Page) {
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
  // Ctrl/Cmd-click on a source clip drops it on the arrangement.
  await page.locator(".source-span").click({ modifiers: ["ControlOrMeta"] });
  await expect(page.locator(".clip-card")).toHaveCount(1);
  await expect(page.locator(".preview-placeholder")).toHaveCount(0, {
    timeout: 30_000,
  });
}

// Slows each exported frame down so the export stays running long enough to
// work alongside, and records each frame's mean brightness (0-255).
async function slowDownExports(page: Page, frameDelayMs: number) {
  await page.evaluate((delay) => {
    const base = window.harness;
    if (!base) throw new Error("no harness");
    const frames: number[] = [];
    (window as { exportedFrames?: number[] }).exportedFrames = frames;
    window.harness = {
      ...base,
      exportVideo(request) {
        return base.exportVideo({
          ...request,
          async renderFrameAt(playheadQ, playheadSeconds) {
            await new Promise((resolve) => setTimeout(resolve, delay));
            await request.renderFrameAt(playheadQ, playheadSeconds);
            const sample = document.createElement("canvas");
            sample.width = 16;
            sample.height = 16;
            const context = sample.getContext("2d");
            if (!context) throw new Error("no 2D context");
            context.drawImage(request.canvas, 0, 0, 16, 16);
            const { data } = context.getImageData(0, 0, 16, 16);
            let sum = 0;
            for (let index = 0; index < data.length; index += 4) {
              sum += data[index] + data[index + 1] + data[index + 2];
            }
            frames.push(sum / (16 * 16 * 3));
          },
        });
      },
    };
  }, frameDelayMs);
}

function exportedFrames(page: Page) {
  return page.evaluate(
    () => (window as { exportedFrames?: number[] }).exportedFrames ?? [],
  );
}

// Starts a small export and returns the dialog.
async function startExport(page: Page) {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Width").fill("320");
  await dialog.getByLabel("Height").fill("180");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog.getByRole("progressbar")).toBeVisible();
  return dialog;
}

function statusProgress(page: Page) {
  return page.getByRole("progressbar", { name: "Background export progress" });
}

async function playheadX(page: Page) {
  return page.evaluate(() => {
    const marker = document.querySelector(
      ".timeline-playhead-marker",
    ) as HTMLElement;
    const content = document.querySelector(
      ".ruler-row__content",
    ) as HTMLElement;
    return (
      marker.getBoundingClientRect().left - content.getBoundingClientRect().left
    );
  });
}

test("hiding the dialog keeps the export running, and reopening it manages the export", async ({
  page,
}) => {
  await slowDownExports(page, 150);
  const dialog = await startExport(page);
  await expect(dialog.locator("[data-export-snapshot]")).toContainText(
    "Exporting the version from",
  );

  // Esc hides the dialog without canceling.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  const progress = statusProgress(page);
  await expect(progress).toBeVisible();
  await expect(page.locator("[data-export-activity]")).toContainText(
    /Exporting/,
  );
  const first = Number((await progress.getAttribute("aria-valuenow")) ?? 0);
  await expect
    .poll(async () => Number(await progress.getAttribute("aria-valuenow")))
    .toBeGreaterThan(first);
  await expect(page.locator("[data-export-activity]")).toContainText(
    /\d+% · \d+:\d\d left/,
  );

  // One export at a time.
  await expect(
    page.getByRole("button", { name: /^(Export|\d+%|Render\.\.\.)$/ }),
  ).toBeDisabled();

  // The status bar item reopens the dialog on the running export.
  await page.locator("[data-export-activity]").click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("progressbar")).toBeVisible();
  await expect(statusProgress(page)).toHaveCount(0);

  // Cancel asks first.
  await dialog.getByRole("button", { name: "Cancel export" }).click();
  await expect(dialog.getByRole("alertdialog")).toContainText(
    "Cancel the export in progress?",
  );
  await dialog.getByRole("button", { name: "Keep exporting" }).click();
  await expect(dialog.getByRole("alertdialog")).toHaveCount(0);
  await expect(dialog.getByRole("progressbar")).toBeVisible();

  await dialog.getByRole("button", { name: "Cancel export" }).click();
  await dialog.getByRole("button", { name: "Stop export" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Export canceled.");
  await expect(dialog.getByRole("progressbar")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Export", exact: true }).first(),
  ).toBeEnabled();
});

test("the editor plays, scrubs and edits during an export, which renders the session as it was", async ({
  page,
}) => {
  await slowDownExports(page, 60);
  const download = page.waitForEvent("download", { timeout: 120_000 });
  const dialog = await startExport(page);
  await dialog.getByRole("button", { name: "Run in background" }).click();
  await expect(dialog).toBeHidden();
  await expect(statusProgress(page)).toBeVisible();

  // Preview playback.
  const start = await playheadX(page);
  await page.getByRole("button", { name: "Play timeline" }).click();
  await expect.poll(() => playheadX(page)).toBeGreaterThan(start + 10);
  await page.getByRole("button", { name: "Pause playback" }).click();

  // Scrubbing on the ruler.
  const view = await page.locator(".timeline-scroll").boundingBox();
  const ruler = await page.locator(".ruler-row__content").boundingBox();
  if (!view || !ruler) throw new Error("ruler is not visible");
  const beforeScrub = await playheadX(page);
  const y = ruler.y + ruler.height / 2;
  await page.mouse.move(view.x + view.width * 0.3, y);
  await page.mouse.down();
  await page.mouse.move(view.x + view.width * 0.45, y, { steps: 8 });
  await page.mouse.up();
  expect(await playheadX(page)).not.toBeCloseTo(beforeScrub, 0);

  // Editing: delete the only clip mid-export.
  await expect(statusProgress(page)).toBeVisible();
  await page.locator(".clip-card").click();
  await page.keyboard.press("Delete");
  await expect(page.locator(".clip-card")).toHaveCount(0);

  await download;
  await expect(statusProgress(page)).toHaveCount(0);
  const notice = page.locator('[data-export-notice="done"]');
  await expect(notice).toContainText("Exported");

  // Every frame still shows the deleted clip, from the snapshot.
  const frames = await exportedFrames(page);
  expect(frames.length).toBeGreaterThan(10);
  for (const brightness of frames) {
    expect(brightness).toBeGreaterThan(8);
  }

  // View reopens the finished export.
  await notice.getByRole("button", { name: "View" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("status")).toContainText("Exported");
  await expect(dialog.locator("[data-export-snapshot]")).toContainText(
    "Exported the version from",
  );
  await expect(notice).toHaveCount(0);
});

test("closing the window mid-export asks to confirm", async ({ page }) => {
  await slowDownExports(page, 150);
  const dialog = await startExport(page);
  await dialog.getByRole("button", { name: "Run in background" }).click();
  await expect(statusProgress(page)).toBeVisible();

  const prompt = page.waitForEvent("dialog");
  await page.close({ runBeforeUnload: true });
  const beforeUnload = await prompt;
  expect(beforeUnload.type()).toBe("beforeunload");
  await beforeUnload.dismiss();
  expect(page.isClosed()).toBe(false);
  await expect(statusProgress(page)).toBeVisible();
});
