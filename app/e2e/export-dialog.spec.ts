import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// Export opens a dialog to choose the In→Out range on a playable preview
// timeline and override the session's output settings for this export only.
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

function field(dialog: Locator, id: string) {
  return dialog.locator(`[data-export-field="${id}"]`);
}

function modifiedDot(dialog: Locator, id: string) {
  return field(dialog, id).getByRole("img", {
    name: "Changed from Session Settings",
  });
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

test("Export opens the dialog pre-filled with Session Settings, and overrides leave them unchanged", async ({
  page,
}) => {
  // The status bar shows the Session Settings, like "320x320 · 15 fps".
  const resolution = page.locator(".status-bar__item", {
    has: page.locator(".status-bar__label", { hasText: "Res" }),
  });
  const sessionResolution = await resolution
    .locator(".status-bar__value")
    .textContent();
  const [, sessionWidth, sessionHeight] =
    sessionResolution?.match(/(\d+)x(\d+)/)?.map(Number) ?? [];

  let dialog = await openExportDialog(page);
  await expect(dialog.getByLabel("Width")).toHaveValue(String(sessionWidth));
  await expect(dialog.getByLabel("Height")).toHaveValue(String(sessionHeight));
  const sessionFps = await frameRateValue(dialog);
  await expect(dialog.getByLabel("File name")).toHaveValue(/\.mp4$/);
  await expect(
    dialog.getByRole("img", { name: "Changed from Session Settings" }),
  ).toHaveCount(0);

  // Override the size, frame rate and codec for this export.
  await pick(dialog, "Resolution preset", "720p 16:9");
  const otherFps = sessionFps === "60" ? "24" : "60";
  await pick(dialog, "Frame rate", `${otherFps} fps`);
  await pick(dialog, "Video codec", "Auto (best available)");
  await expect(modifiedDot(dialog, "resolution")).toBeVisible();
  await expect(modifiedDot(dialog, "fps")).toBeVisible();
  await expect(resolution.locator(".status-bar__value")).toHaveText(
    sessionResolution ?? "",
  );

  // Closing keeps the overrides for the next Export, not the session.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(resolution.locator(".status-bar__value")).toHaveText(
    sessionResolution ?? "",
  );
  dialog = await openExportDialog(page);
  await expect(frameRate(dialog)).toHaveText(`${otherFps} fps`);
  await expect(dialog.getByLabel("Width")).toHaveValue("1280");

  // Reset restores the Session Settings, which never changed.
  await dialog
    .getByRole("button", { name: "Reset to session settings" })
    .click();
  await expect(frameRate(dialog)).toHaveText(`${sessionFps} fps`);
  await expect(dialog.getByLabel("Width")).toHaveValue(String(sessionWidth));
  await expect(dialog.getByLabel("Height")).toHaveValue(String(sessionHeight));
  await expect(
    dialog.getByRole("img", { name: "Changed from Session Settings" }),
  ).toHaveCount(0);
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
  // Browser downloads can't be revealed, so the done state only closes.
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

test("Cancel stops an export in progress", async ({ page }) => {
  const dialog = await openExportDialog(page);
  // A large, high-frame-rate export takes long enough to cancel.
  await pick(dialog, "Resolution preset", "1080p 16:9");
  await pick(dialog, "Frame rate", "60 fps");

  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog.getByRole("progressbar")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel export" }).click();
  await dialog.getByRole("button", { name: "Stop export" }).click();

  await expect(dialog.getByRole("status")).toHaveText("Export canceled.");
  await expect(dialog.getByRole("progressbar")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Export", exact: true }),
  ).toBeEnabled();
});
