import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// Playwright, not a component test: these run real exports and real
// preview playback in the app.
//
// Export opens a dialog to choose the In→Out range on a playable preview
// timeline and override the session's output settings for this export only.
// Its Session Settings pre-fill and overrides are covered by
// ExportDialog.component.test.tsx.
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

test.use({ viewport: { width: 1600, height: 1200 } });

test.beforeEach(async ({ page }) => {
  // Without the save picker the web harness saves through a download,
  // which the tests can read.
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await addVideoClip(page);
});

// Picks an option from one of the dialog's dropdowns.
async function pick(dialog: Locator, name: string, option: string) {
  await dialog.getByRole("combobox", { name, exact: true }).click();
  await dialog
    .page()
    .getByRole("option", { name: option, exact: true })
    .click();
}

function frameRate(dialog: Locator) {
  return dialog.getByRole("combobox", { name: "Frame rate" });
}

async function frameRateValue(dialog: Locator) {
  return ((await frameRate(dialog).textContent()) ?? "").replace(" fps", "");
}

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

async function openExportDialog(page: Page) {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

// Returns the payload bounds of the first `type` box in data[start, end).
function findBox(data: Buffer, start: number, end: number, type: string) {
  let offset = start;
  while (offset + 8 <= end) {
    // A 32-bit size of 1 means a 64-bit size follows the type.
    const extended = data.readUInt32BE(offset) === 1;
    const header = extended ? 16 : 8;
    const size = extended
      ? Number(data.readBigUInt64BE(offset + 8))
      : data.readUInt32BE(offset);
    if (size < header || offset + size > end) return null;
    if (data.toString("latin1", offset + 4, offset + 8) === type)
      return { start: offset + header, end: offset + size };
    offset += size;
  }
  return null;
}

// The movie's duration in seconds, from moov/mvhd.
function readDurationSeconds(mp4: Buffer) {
  const moov = findBox(mp4, 0, mp4.length, "moov");
  if (!moov) throw new Error("MP4 has no moov box");
  const mvhd = findBox(mp4, moov.start, moov.end, "mvhd");
  if (!mvhd) throw new Error("MP4 has no mvhd box");
  const version = mp4.readUInt8(mvhd.start);
  const timescale = mp4.readUInt32BE(mvhd.start + (version === 1 ? 20 : 12));
  const duration =
    version === 1
      ? Number(mp4.readBigUInt64BE(mvhd.start + 24))
      : mp4.readUInt32BE(mvhd.start + 16);
  return duration / timescale;
}

async function frameCount(dialog: Locator) {
  const text = await dialog.locator("[data-export-estimate]").textContent();
  const match = text?.match(/\((\d+) frames\)/);
  if (!match) throw new Error(`No frame count in "${text}"`);
  return Number(match[1]);
}

test("File ▸ Export ▸ Video… opens the export dialog", async ({ page }) => {
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export", exact: true }).click();
  await page.getByRole("menuitem", { name: "Video…", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("File name")).toHaveValue(/\.mp4$/);
});

test("dragging In and Out exports only that span", async ({ page }) => {
  const dialog = await openExportDialog(page);
  // Small output, so the export is quick.
  await dialog.getByLabel("Width").fill("320");
  await dialog.getByLabel("Height").fill("180");
  const fullFrames = await frameCount(dialog);

  const strip = dialog.locator("[data-export-range]");
  const box = await strip.boundingBox();
  if (!box) throw new Error("range timeline is not visible");
  const inMarker = dialog.locator('[data-export-marker="in"]');
  const outMarker = dialog.locator('[data-export-marker="out"]');
  const inBox = await inMarker.boundingBox();
  const outBox = await outMarker.boundingBox();
  if (!inBox || !outBox) throw new Error("markers are not visible");
  const inX = inBox.x + inBox.width / 2;
  const outX = outBox.x + outBox.width / 2;
  const y = box.y + box.height / 2;

  // Shift drags are frame-accurate: In to a quarter, Out to three quarters.
  await page.keyboard.down("Shift");
  await page.mouse.move(inX, y);
  await page.mouse.down();
  await page.mouse.move(inX + (outX - inX) * 0.25, y, { steps: 5 });
  await page.mouse.up();
  await page.mouse.move(outX, y);
  await page.mouse.down();
  await page.mouse.move(inX + (outX - inX) * 0.75, y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Shift");

  const frames = await frameCount(dialog);
  expect(frames).toBeLessThan(fullFrames * 0.7);
  expect(frames).toBeGreaterThan(fullFrames * 0.3);
  const fps = Number(await frameRateValue(dialog));

  const download = page.waitForEvent("download", { timeout: 120_000 });
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const mp4 = await readFile(await (await download).path());
  await expect(dialog.getByRole("status")).toContainText("Exported");
  expect(Math.abs(readDurationSeconds(mp4) - frames / fps)).toBeLessThan(
    1.5 / fps,
  );
  // Browser downloads can't be revealed, so the done state offers Share
  // and Close.
  await expect(dialog.getByRole("button", { name: "Share" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Reveal file" })).toHaveCount(
    0,
  );
});

test("Reveal file shows a native export in the file manager", async ({
  page,
}) => {
  // Stands in for the desktop harness: saves to a path and can reveal it.
  // The render still runs through the web harness's download flow.
  await page.evaluate(() => {
    const base = window.harness;
    if (!base) throw new Error("no harness");
    const revealed: unknown[] = [];
    (window as { revealed?: unknown[] }).revealed = revealed;
    window.harness = {
      ...base,
      capabilities: { ...base.capabilities, "reveal-saved-file": true },
      async prepareSave(filename) {
        return { kind: "native-path", filename, path: `/exports/${filename}` };
      },
      async exportVideo(request) {
        const result = await base.exportVideo({
          ...request,
          saveTarget: { kind: "download", filename: request.filename },
        });
        return { ...result, saveMethod: "native-path" };
      },
      async revealSavedFile(target) {
        revealed.push(target);
      },
    };
  });

  const dialog = await openExportDialog(page);
  await dialog.getByLabel("Width").fill("320");
  await dialog.getByLabel("Height").fill("180");
  await dialog.getByLabel("File name").fill("reveal.mp4");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Saved reveal.mp4", {
    timeout: 120_000,
  });

  await dialog.getByRole("button", { name: "Reveal file" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as { revealed?: unknown[] }).revealed),
    )
    .toEqual([
      {
        kind: "native-path",
        filename: "reveal.mp4",
        path: "/exports/reveal.mp4",
      },
    ]);
  await expect(dialog.getByRole("button", { name: "Close" })).toBeVisible();
});

test("playback loops from In to Out", async ({ page }) => {
  const dialog = await openExportDialog(page);
  const body = dialog.locator(".export-dialog__body");
  // A third of a second from In.
  const inText = await dialog.getByLabel("In timecode").inputValue();
  const [minutes, seconds] = inText.split(":").map(Number);
  const inSeconds = minutes * 60 + seconds;
  const out = `00:${String(inSeconds).padStart(2, "0")}:10`;
  await dialog.getByLabel("Out timecode").fill(out);
  await dialog.getByLabel("Out timecode").press("Enter");
  await expect(dialog.getByLabel("Out timecode")).toHaveValue(out);
  const outQ = Number(
    await dialog
      .locator('[data-export-marker="out"]')
      .getAttribute("aria-valuenow"),
  );
  const inQ = Number(
    await dialog
      .locator('[data-export-marker="in"]')
      .getAttribute("aria-valuenow"),
  );

  await body.focus();
  await page.keyboard.press("Space");
  await expect(body).toHaveAttribute("data-playing", "true");

  const positions: number[] = [];
  for (let sample = 0; sample < 30; sample++) {
    positions.push(Number(await body.getAttribute("data-playhead-q")));
    await page.waitForTimeout(50);
  }
  await expect(body).toHaveAttribute("data-playing", "true");
  for (const q of positions) {
    expect(q).toBeGreaterThanOrEqual(inQ - 1e-6);
    expect(q).toBeLessThanOrEqual(outQ + 1e-6);
  }
  // It wrapped back to In at least once.
  expect(
    positions.some((q, index) => index > 0 && q < positions[index - 1]),
  ).toBe(true);

  await page.keyboard.press("Space");
  await expect(body).toHaveAttribute("data-playing", "false");
});

test("Export sits top left over a full-width notice row, with the estimate under the settings", async ({
  page,
}) => {
  const dialog = await openExportDialog(page);
  const box = (locator: Locator) =>
    locator.evaluate((element) => element.getBoundingClientRect().toJSON());
  const header = dialog.locator(".dialog-header");
  const side = await box(dialog.locator(".export-dialog__side"));
  const preview = await box(dialog.locator(".export-dialog__preview-column"));
  const range = await box(dialog.locator(".export-dialog__range"));

  // The title only names the dialog; nothing shows it.
  await expect(page.getByRole("dialog", { name: "Export" })).toBeVisible();
  const title = await box(header.getByRole("heading", { name: "Export" }));
  expect(title.width).toBeLessThanOrEqual(1);

  // Export is at the top left, where the title was, above the settings;
  // there is no Cancel while editing, and no footer row.
  const exportButton = header.getByRole("button", {
    name: "Export",
    exact: true,
  });
  await expect(exportButton).toHaveCount(1);
  const exportBounds = await box(exportButton);
  const dismiss = await box(
    header.getByRole("button", { name: "Dismiss dialog" }),
  );
  expect(Math.abs(exportBounds.left - preview.left)).toBeLessThan(1);
  expect(Math.abs(exportBounds.top - dismiss.top)).toBeLessThan(12);
  expect(exportBounds.bottom).toBeLessThanOrEqual(side.top);
  await expect(
    dialog.getByRole("button", { name: "Cancel", exact: true }),
  ).toHaveCount(0);
  await expect(dialog.locator(".dialog-footer")).toHaveCount(0);
  // No status shows until an export runs.
  await expect(dialog.locator("[data-export-progress-status]")).toHaveCount(0);

  // The notice fills the full-width row under Export, and still describes
  // the dialog.
  const row = await box(dialog.locator("[data-export-progress-row]"));
  expect(Math.abs(row.left - preview.left)).toBeLessThan(1);
  expect(Math.abs(row.right - side.right)).toBeLessThan(1);
  expect(row.top).toBeGreaterThanOrEqual(exportBounds.bottom);
  expect(row.bottom).toBeLessThanOrEqual(side.top);
  const notice = dialog.locator("#export-dialog-description");
  await expect(notice).toBeVisible();
  await expect(notice).toHaveText(/^Choose the range to export/);
  await expect(dialog).toHaveAttribute(
    "aria-describedby",
    "export-dialog-description",
  );
  const noticeBounds = await box(notice);
  expect(noticeBounds.top).toBeGreaterThanOrEqual(row.top);
  expect(noticeBounds.bottom).toBeLessThanOrEqual(row.bottom);

  // The estimate is under the settings, not in the header.
  await expect(header.locator("[data-export-estimate]")).toHaveCount(0);
  const estimate = await box(
    dialog.locator("[data-export-status] [data-export-estimate]"),
  );
  const lastField = await box(dialog.locator('[data-export-field="fileName"]'));
  expect(estimate.top).toBeGreaterThan(lastField.bottom);
  expect(estimate.left).toBeGreaterThanOrEqual(side.left);
  expect(estimate.bottom).toBeLessThanOrEqual(side.bottom);

  // The settings column ends with the preview column, so the range sits
  // right below both.
  expect(Math.abs(side.bottom - preview.bottom)).toBeLessThan(1);
  expect(range.top - preview.bottom).toBeLessThan(24);
});

test("Cancel stops an export in progress", async ({ page }) => {
  const dialog = await openExportDialog(page);
  // The settings stay put while the header changes state.
  const settingsTop = () =>
    dialog
      .locator(".export-dialog__side")
      .evaluate((element) => element.getBoundingClientRect().top);
  const editingTop = await settingsTop();
  // A large, high-frame-rate export takes long enough to cancel.
  await pick(dialog, "Resolution preset", "1080p 16:9");
  await pick(dialog, "Frame rate", "60 fps");

  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog.getByRole("progressbar")).toBeVisible();
  // The notice gives way to the bar.
  await expect(dialog.locator("#export-dialog-description")).toBeHidden();
  expect(await settingsTop()).toBeCloseTo(editingTop, 0);
  await dialog.getByRole("button", { name: "Cancel export" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Stop export" })
    .click();

  // The message shows under where the progress bar was.
  await expect(
    dialog.locator("[data-export-progress-status]").getByRole("status"),
  ).toHaveText("Export canceled.");
  await expect(dialog.getByRole("progressbar")).toHaveCount(0);
  await expect(dialog.locator("#export-dialog-description")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Export", exact: true }),
  ).toBeEnabled();
  expect(await settingsTop()).toBeCloseTo(editingTop, 0);
});
