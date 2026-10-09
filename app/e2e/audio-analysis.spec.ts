import { expect, type Page, test } from "@playwright/test";

// The Audio toggle in the preview header shows an audio analysis area below
// the monitor: a spectrogram of the program mix with a vertical master VU
// meter at its right edge.
const DROP_AREA = '[aria-label="Source track drop area"]';

function audioToggle(page: Page) {
  return page.locator(".preview-panel__header").getByRole("button", {
    name: "Audio",
  });
}

function pane(page: Page) {
  return page.getByRole("region", { name: "Audio analysis" });
}

function paneLevel(page: Page) {
  return pane(page).getByRole("meter", { name: "Left level" });
}

// A 440 Hz mono tone at about -13 dBFS RMS, as a 16-bit WAV.
function toneWav(seconds = 30, sampleRate = 8000) {
  const frames = Math.round(seconds * sampleRate);
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(frames * 2, 40);
  for (let index = 0; index < frames; index++) {
    const sample = Math.sin((2 * Math.PI * 440 * index) / sampleRate);
    wav.writeInt16LE(Math.round(sample * 10_000), 44 + index * 2);
  }
  return wav.toString("base64");
}

async function addSourceAudio(page: Page, sampleRate?: number) {
  const base64 = toneWav(30, sampleRate);
  const dataTransfer = await page.evaluateHandle((data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "tone.wav", { type: "audio/wav" }));
    return transfer;
  }, base64);
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(DROP_AREA, type, { dataTransfer });
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
}

// The spectrogram's newest column, as each row's brightness (the sum of its
// red, green and blue), top first, and the background's.
async function newestColumn(page: Page) {
  return page.locator(".spectrogram__canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("No 2D context");
    }
    const { data } = context.getImageData(
      canvas.width - 1,
      0,
      1,
      canvas.height,
    );
    const rows: number[] = [];
    for (let index = 0; index < data.length; index += 4) {
      rows.push(data[index] + data[index + 1] + data[index + 2]);
    }
    return { rows, background: 27 + 29 + 42 };
  });
}

test("the Audio toggle shows the meter and spectrogram below the preview", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await expect(audioToggle(page)).toBeVisible();

  await expect(audioToggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(pane(page)).toHaveCount(0);

  await audioToggle(page).click();
  await expect(audioToggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(pane(page)).toBeVisible();

  const monitor = await page.locator(".preview-monitor").boundingBox();
  const area = await pane(page).boundingBox();
  const spectrogram = await pane(page).locator(".spectrogram").boundingBox();
  const bars = await pane(page).locator(".vu-meter__bars").boundingBox();
  if (!monitor || !area || !spectrogram || !bars) {
    throw new Error("The audio analysis area is not laid out");
  }
  // Below the monitor, with the meter at the right edge of the spectrogram.
  expect(area.y).toBeGreaterThanOrEqual(monitor.y + monitor.height);
  expect(bars.x).toBeGreaterThanOrEqual(spectrogram.x + spectrogram.width);
  expect(area.x + area.width - (bars.x + bars.width)).toBeLessThan(40);
  // The meter is vertical.
  expect(bars.height).toBeGreaterThan(bars.width * 2);
  await expect(paneLevel(page)).toHaveAttribute("aria-valuenow", "-60");

  // It stays open on the Media tab, and after a reload.
  await page
    .locator(".preview-panel__tabs")
    .getByRole("tab", { name: "Media" })
    .click();
  await expect(pane(page)).toBeVisible();
  await page.reload();
  await expect(pane(page)).toBeVisible();

  await audioToggle(page).click();
  await expect(audioToggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(pane(page)).toHaveCount(0);
});

test("the meter and spectrogram follow the master output", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await addSourceAudio(page);
  await audioToggle(page).click();

  await page.getByRole("button", { name: "Play timeline" }).click();
  await expect
    .poll(async () =>
      Number(await paneLevel(page).getAttribute("aria-valuenow")),
    )
    .toBeGreaterThan(-30);

  // The tone lights the spectrogram's newest column where 440 Hz sits on the
  // log scale (20 Hz–20 kHz), and leaves the top of it dark.
  await expect
    .poll(async () => {
      const { rows, background } = await newestColumn(page);
      const brightest = rows.indexOf(Math.max(...rows));
      return rows[brightest] > background + 60 ? brightest / rows.length : -1;
    })
    .toBeGreaterThan(0.4);
  const { rows, background } = await newestColumn(page);
  const peak = rows.indexOf(Math.max(...rows)) / rows.length;
  const expected = 1 - Math.log(440 / 20) / Math.log(1000);
  expect(Math.abs(peak - expected)).toBeLessThan(0.05);
  expect(rows[0]).toBeLessThan(background + 30);

  // Stopped, the meter decays to empty and the spectrogram holds still.
  await page.getByRole("button", { name: "Pause playback" }).click();
  await expect(paneLevel(page)).toHaveAttribute("aria-valuenow", "-60", {
    timeout: 10_000,
  });
  const held = await newestColumn(page);
  await page.waitForTimeout(300);
  expect((await newestColumn(page)).rows).toEqual(held.rows);
});

test("on the Media tab the meter follows the media playing there", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  // WebKit, which follows the media through a copy routed into Web Audio,
  // routes nothing from 8 kHz media.
  await addSourceAudio(page, 48_000);
  await audioToggle(page).click();

  await page.getByRole("button", { name: "Media", exact: true }).click();
  await page.getByRole("option").filter({ hasText: "tone" }).dblclick();
  await expect(page.locator(".preview-panel__title")).toHaveText("tone.wav");
  await page.getByRole("button", { name: "Play media" }).click();
  await expect
    .poll(async () =>
      Number(await paneLevel(page).getAttribute("aria-valuenow")),
    )
    .toBeGreaterThan(-30);

  await page.getByRole("button", { name: "Pause media" }).click();
  await expect(paneLevel(page)).toHaveAttribute("aria-valuenow", "-60", {
    timeout: 10_000,
  });
});
