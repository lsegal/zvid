import { expect, type Page, test } from "@playwright/test";

// Calibrates the VU meter against the preview's real mixer: the meter reads
// the program mix, after every clip and master Gain and before the preview
// volume. Each clip's element plays a Web Audio-generated -12 dBFS 1 kHz
// sine in place of its media, so headless Chromium's media-element
// dropouts (see loudest() in vu-meter.spec.ts) can't skew the levels.
const DROP_AREA = '[aria-label="Source track drop area"]';
const SILENT = "-inf dB";
const CLIP_DEVICES = '.fx-chain .fx-device-panel[data-fx-group="clip"]';
const TONE_DB = -12;
// A sine's RMS is 3.01 dB below its peak.
const SINE_RMS_DB = -3.01;
const METER_MIN_DB = -60;
const METER_MAX_DB = 6;

test.use({ viewport: { width: 1600, height: 1200 } });
test.describe.configure({ timeout: 90_000 });

// Every media element source the mixer makes plays the tone while its
// element plays, and is silent while the element is paused.
async function replaceClipAudioWithTone(page: Page) {
  await page.addInitScript((db) => {
    const createSource = AudioContext.prototype.createMediaElementSource;
    AudioContext.prototype.createMediaElementSource = function (
      this: AudioContext,
      element: HTMLMediaElement,
    ) {
      // The element still routes into Web Audio, but nothing hears it.
      createSource.call(this, element);
      const oscillator = this.createOscillator();
      oscillator.frequency.value = 1000;
      const gate = this.createGain();
      const amplitude = 10 ** (db / 20);
      const follow = () => {
        gate.gain.value = element.paused ? 0 : amplitude;
      };
      for (const type of ["play", "playing", "pause", "ended", "emptied"]) {
        element.addEventListener(type, follow);
      }
      follow();
      oscillator.connect(gate);
      oscillator.start();
      return gate as unknown as MediaElementAudioSourceNode;
    };
  }, TONE_DB);
}

// A silent mono WAV, long enough to keep playing through every check. Its
// samples are never heard; it only makes a clip with sound, and so a Gain.
function silentWav(seconds = 60) {
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
  // A quiet hiss rather than digital silence, so it reads as audio.
  for (let index = 0; index < frames; index++) {
    wav.writeInt16LE(index % 2 ? 1 : -1, 44 + index * 2);
  }
  return wav.toString("base64");
}

async function addSourceAudio(page: Page) {
  const dataTransfer = await page.evaluateHandle((data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "clip.wav", { type: "audio/wav" }));
    return transfer;
  }, silentWav());
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(DROP_AREA, type, { dataTransfer });
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
}

// The left bar's level in dB, from the position it is drawn at, which
// aria-valuenow rounds to whole dB.
async function barDb(page: Page) {
  const position = await page
    .getByRole("meter", { name: "Left level" })
    .evaluate((row) =>
      Number((row as HTMLElement).style.getPropertyValue("--vu-level") || 0),
    );
  return position > 0
    ? METER_MIN_DB + position * (METER_MAX_DB - METER_MIN_DB)
    : -Infinity;
}

async function readoutDb(page: Page) {
  const text = (await page.locator(".vu-meter__readout").textContent()) ?? "";
  return text === SILENT
    ? -Infinity
    : Number(text.replace(" dB", "").replace("−", "-").replace("+", ""));
}

type Levels = { bar: number; readout: number };

async function levels(page: Page): Promise<Levels> {
  return { bar: await barDb(page), readout: await readoutDb(page) };
}

// The levels once the bars' release and the readout's 300 ms window have
// settled: four readings in a row within 0.1 dB of each other.
async function settledLevels(page: Page) {
  const readings: Levels[] = [];
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    readings.push(await levels(page));
    const recent = readings.slice(-4);
    if (
      recent.length === 4 &&
      (["bar", "readout"] as const).every((key) => {
        const values = recent.map((reading) => reading[key]);
        return Math.max(...values) - Math.min(...values) <= 0.1;
      })
    ) {
      return recent[3];
    }
    await page.waitForTimeout(150);
  }
  throw new Error(`The meter never settled: ${JSON.stringify(readings)}`);
}

function expectNear(actual: number, expected: number, tolerance = 0.2) {
  expect(
    Math.abs(actual - expected),
    `${actual} vs ${expected}`,
  ).toBeLessThanOrEqual(tolerance);
}

async function setClipGain(page: Page, db: string) {
  await page.locator(".source-span").click();
  const gain = page.locator(CLIP_DEVICES);
  await gain.getByRole("button", { name: /^Gain: / }).click();
  const input = gain.getByRole("textbox", { name: "Gain value" });
  await input.fill(db);
  await input.press("Enter");
}

test.beforeEach(async ({ page }) => {
  await replaceClipAudioWithTone(page);
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await addSourceAudio(page);
});

test("a clip's Gain moves the bars and the readout by the same dB", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Play timeline" }).click();
  await expect.poll(() => readoutDb(page)).toBeGreaterThan(-30);
  const unity = await settledLevels(page);
  expectNear(unity.bar, TONE_DB);
  expectNear(unity.readout, TONE_DB + SINE_RMS_DB);

  await setClipGain(page, "-6");
  await expect(
    page.locator(CLIP_DEVICES).getByRole("slider", { name: "Gain" }),
  ).toHaveAttribute("aria-valuetext", "−6.0 dB");
  await expect.poll(() => readoutDb(page)).toBeLessThan(unity.readout - 3);
  const lowered = await settledLevels(page);
  expectNear(unity.bar - lowered.bar, 6);
  expectNear(unity.readout - lowered.readout, 6);
});

test("the preview volume changes neither the bars nor the readout", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Play timeline" }).click();
  await expect.poll(() => readoutDb(page)).toBeGreaterThan(-30);
  const full = await settledLevels(page);

  const volume = page.getByRole("slider", { name: "Preview volume" });
  for (const value of ["0.25", "0"]) {
    await volume.fill(value);
    const quieter = await settledLevels(page);
    expectNear(quieter.bar, full.bar);
    expectNear(quieter.readout, full.readout);
  }

  await volume.fill("1");
  await page.getByRole("button", { name: /^Mute preview/ }).click();
  const muted = await settledLevels(page);
  expectNear(muted.bar, full.bar);
  expectNear(muted.readout, full.readout);
});

test("with nothing contributing to the mix the meter reads empty", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Play timeline" }).click();
  await expect.poll(() => readoutDb(page)).toBeGreaterThan(-30);

  // A muted Gain drops the only clip out of the mix while it plays.
  await page.locator(".source-span").click();
  await page
    .locator(CLIP_DEVICES)
    .getByRole("button", { name: "Mute Gain" })
    .click();
  await expect(page.locator(".vu-meter__readout")).toHaveText(SILENT, {
    timeout: 10_000,
  });
  await expect.poll(() => barDb(page), { timeout: 10_000 }).toBe(-Infinity);
  for (const name of ["Left level", "Right level"]) {
    await expect(page.getByRole("meter", { name })).toHaveAttribute(
      "aria-valuenow",
      "-60",
      { timeout: 10_000 },
    );
  }
  await expect(
    page.getByRole("button", { name: "Pause playback" }),
  ).toBeVisible();
});
