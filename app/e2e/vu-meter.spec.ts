import { expect, type Page, test } from "@playwright/test";

// Stays in Playwright: it meters the real mixer playing an imported clip.
// TransportBar.component.test.tsx covers the meter's layout and colors.
//
// The transport bar's stereo VU meter meters the program mix (the clips'
// audio mix) before the preview volume, and decays to empty when playback
// stops.
const DROP_AREA = '[aria-label="Source track drop area"]';
const SILENT = "-inf dB";

function readout(page: Page) {
  return page.locator(".vu-meter__readout");
}

function channel(page: Page, name: "Left level" | "Right level") {
  return page.getByRole("meter", { name });
}

async function level(page: Page, name: "Left level" | "Right level") {
  return Number(await channel(page, name).getAttribute("aria-valuenow"));
}

async function readoutDb(page: Page) {
  const text = (await readout(page).textContent()) ?? "";
  return text === SILENT
    ? -Infinity
    : Number(text.replace(" dB", "").replace("−", "-"));
}

// A 440 Hz mono tone at about -13 dBFS RMS, long enough to keep playing
// through every check, as a 16-bit WAV.
function toneWav(seconds = 30) {
  const sampleRate = 8000;
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

// Dropped on the source tracks, the tone plays as a source clip with a
// 0 dB Gain.
async function addSourceAudio(page: Page) {
  const base64 = toneWav();
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

// The loudest of a few readings over 300 ms. Headless Chromium's media
// playback has short dropouts, which a single reading can land in.
async function loudest(read: () => Promise<number>) {
  let max = -Infinity;
  for (let index = 0; index < 6; index++) {
    max = Math.max(max, await read());
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return max;
}

test.use({ viewport: { width: 1600, height: 900 } });

test("the meter reads the audio mix regardless of the preview volume", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await addSourceAudio(page);

  await page.getByRole("button", { name: "Play timeline" }).click();
  // Both bars fill from the mono tone, and the readout shows its level.
  await expect.poll(() => level(page, "Left level")).toBeGreaterThan(-30);
  await expect.poll(() => level(page, "Right level")).toBeGreaterThan(-30);
  await expect.poll(() => readoutDb(page)).toBeGreaterThan(-30);
  expect(await readoutDb(page)).toBeLessThan(0);

  // Silencing the preview leaves the program level audible on the meter.
  // (vu-meter-calibration.spec.ts checks the levels themselves.)
  await page.getByRole("slider", { name: "Preview volume" }).fill("0");
  expect(await loudest(() => level(page, "Left level"))).toBeGreaterThan(-30);
  expect(await loudest(() => readoutDb(page))).toBeGreaterThan(-30);

  await page.getByRole("button", { name: "Pause playback" }).click();
  await expect(readout(page)).toHaveText(SILENT, { timeout: 10_000 });
  await expect(channel(page, "Left level")).toHaveAttribute(
    "aria-valuenow",
    "-60",
    { timeout: 10_000 },
  );
  await expect(page.locator(".vu-meter__channel.has-peak")).toHaveCount(0, {
    timeout: 10_000,
  });
});
