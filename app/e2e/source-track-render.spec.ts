import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// With no layer clips, the preview and export render the source tracks as
// layers; once a layer clip exists, they render the layers again.
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

test.use({ viewport: { width: 1600, height: 1200 } });

test.beforeEach(async ({ page }) => {
  // Without the save picker the web harness saves through a download.
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
});

async function addSourceVideo(page: Page) {
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

// Records each exported frame's mean brightness (0-255).
async function recordExportedFrames(page: Page) {
  await page.evaluate(() => {
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
  });
}

const monitor = ".preview-monitor";

test("the preview renders the source tracks until there is a layer clip", async ({
  page,
}) => {
  await addSourceVideo(page);
  await expect(page.locator(".clip-card")).toHaveCount(0);

  // The source media plays at the playhead, so nothing covers the preview.
  await expect(page.locator(monitor)).toHaveAttribute(
    "data-render-source",
    "source-tracks",
  );
  await expect(page.locator(".preview-placeholder")).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(page.locator(".preview-panel__clip")).not.toHaveText(
    "No clip at playhead",
  );
  // The source tracks aren't layers: the overlay can't edit them.
  await expect(page.locator("[data-timeline-lane-id^='source-render:']")).toHaveCount(0);

  // Ctrl/Cmd-click on a source clip drops it on the arrangement.
  await page.locator(".source-span").click({ modifiers: ["ControlOrMeta"] });
  await expect(page.locator(".clip-card")).toHaveCount(1);
  await expect(page.locator(monitor)).toHaveAttribute(
    "data-render-source",
    "layers",
  );

  // Removing the last layer clip renders the source tracks again.
  await page.locator(".clip-card").click();
  await page.keyboard.press("Delete");
  await expect(page.locator(".clip-card")).toHaveCount(0);
  await expect(page.locator(monitor)).toHaveAttribute(
    "data-render-source",
    "source-tracks",
  );
  await expect(page.locator(".preview-placeholder")).toHaveCount(0);
});

test("export needs a layer clip or a source track", async ({ page }) => {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("Open a session or import media before exporting."),
  ).toBeVisible();
});

test("exporting a session with no layer clips renders the source tracks", async ({
  page,
}) => {
  await addSourceVideo(page);
  await expect(page.locator(".clip-card")).toHaveCount(0);
  await recordExportedFrames(page);

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Width").fill("320");
  await dialog.getByLabel("Height").fill("180");
  const download = page.waitForEvent("download", { timeout: 120_000 });
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await download;
  await expect(dialog.getByRole("status")).toContainText("Exported", {
    timeout: 120_000,
  });

  // Every frame shows the source video rather than an empty (black) canvas.
  const frames = await page.evaluate(
    () => (window as { exportedFrames?: number[] }).exportedFrames ?? [],
  );
  expect(frames.length).toBeGreaterThan(10);
  for (const brightness of frames) {
    expect(brightness).toBeGreaterThan(8);
  }
});
