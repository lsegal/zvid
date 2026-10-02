import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// The Stereo audio effect: it is added from a clip's Audio add menu with
// Width at 100% and Pan at centre, and panning a centred tone hard left
// moves it all to the left channel in the preview and the export alike.

const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

test.use({ viewport: { width: 1600, height: 1200 } });
test.describe.configure({ timeout: 120_000 });

// Records the analysers the preview's mixer makes, which hear the mix after
// every chain, downmixed to mono.
async function probeAnalysers(page: Page) {
  await page.addInitScript(() => {
    const probe = window as unknown as { analysers: AnalyserNode[] };
    probe.analysers = [];
    const createAnalyser = AudioContext.prototype.createAnalyser;
    AudioContext.prototype.createAnalyser = function (this: AudioContext) {
      const analyser = createAnalyser.call(this);
      probe.analysers.push(analyser);
      return analyser;
    };
  });
}

// The mix's steadiest RMS level over a few reads of the analyser.
async function settledLevel(page: Page) {
  let level = 0;
  for (let read = 0; read < 6; read += 1) {
    level = Math.max(
      level,
      await page.evaluate(() => {
        const probe = window as unknown as { analysers: AnalyserNode[] };
        const analyser = probe.analysers.at(-1);
        if (!analyser) {
          return 0;
        }
        const samples = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(samples);
        let total = 0;
        for (const sample of samples) {
          total += sample * sample;
        }
        return Math.sqrt(total / samples.length);
      }),
    );
    await page.waitForTimeout(50);
  }
  return level;
}

// A 440 Hz tone as a 16-bit mono WAV, which the chains upmix to a centred
// stereo source.
function toneWav(seconds: number) {
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

async function addTone(page: Page, seconds: number) {
  const dataTransfer = await page.evaluateHandle((base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "tone.wav", { type: "audio/wav" }));
    return transfer;
  }, toneWav(seconds));
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent('[aria-label="Source track drop area"]', type, {
      dataTransfer,
    });
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
}

const clipDevices = '.fx-chain .fx-device-panel[data-fx-group="clip"]';

// Adds Stereo to the selected clip from its add menu, which for a clip
// with only sound lists the audio effects alone.
async function addStereo(page: Page) {
  await page
    .getByRole("button", { name: "Add device to this clip" })
    .first()
    .click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("group", { name: "Video" })).toHaveCount(0);
  await menu
    .getByRole("menuitem", { name: "Volume & Stereo" })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^Stereo/ }).click();
  const stereo = page.locator(`${clipDevices}[aria-label="Stereo"]`);
  await expect(stereo).toHaveCount(1);
  return stereo;
}

// Pans the Stereo hard left from the keyboard: Home is the knob's minimum.
async function panHardLeft(page: Page) {
  await page
    .locator(`${clipDevices}[aria-label="Stereo"]`)
    .getByRole("slider", { name: "Pan" })
    .press("Home");
}

async function playFromStart(page: Page) {
  for (let bar = 0; bar < 2; bar += 1) {
    await page.getByRole("button", { name: "Jump back one bar" }).click();
  }
  await page.getByRole("button", { name: "Play timeline" }).click();
}

test("a video clip lists Stereo in its add menu's Audio group", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  const dataTransfer = await page.evaluateHandle(
    (base64) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([bytes], "test-pattern.mp4", { type: "video/mp4" }),
      );
      return transfer;
    },
    (await readFile(VIDEO)).toString("base64"),
  );
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent('[aria-label="Source track drop area"]', type, {
      dataTransfer,
    });
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
  await page.locator(".source-span").click();
  await page
    .getByRole("button", { name: "Add device to this clip" })
    .first()
    .click();
  const audio = page.getByRole("menu").getByRole("group", { name: "Audio" });
  await audio
    .getByRole("menuitem", { name: "Volume & Stereo" })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^Stereo/ }).click();
  await expect(page.locator(`${clipDevices}[aria-label="Stereo"]`)).toHaveCount(
    1,
  );
});

test("Stereo adds with its defaults and pans the preview", async ({ page }) => {
  await probeAnalysers(page);
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  // Long enough to keep playing through every check.
  await addTone(page, 30);
  await page.locator(".source-span").click();

  const stereo = await addStereo(page);
  await expect(stereo.getByRole("img", { name: "Audio effect" })).toBeVisible();
  await expect(
    stereo.getByRole("button", { name: /Turn Animation/ }),
  ).toHaveCount(0);
  await expect(stereo.getByRole("slider", { name: "Width" })).toHaveAttribute(
    "aria-valuetext",
    "100%",
  );
  await expect(stereo.getByRole("slider", { name: "Pan" })).toHaveAttribute(
    "aria-valuetext",
    "C",
  );

  await playFromStart(page);
  let centred = 0;
  await expect
    .poll(
      async () => {
        centred = await settledLevel(page);
        return centred;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0.05);

  // Hard left: the left channel rises 3 dB and the right falls silent, so
  // the mono downmix the analyser hears drops to 1/√2 of its level.
  await panHardLeft(page);
  await expect(stereo.getByRole("slider", { name: "Pan" })).toHaveAttribute(
    "aria-valuetext",
    "L 100",
  );
  await expect
    .poll(
      async () => {
        const ratio = (await settledLevel(page)) / centred;
        return ratio > 0.62 && ratio < 0.8;
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  // Bypassing it brings the centred level back.
  await stereo.getByRole("button", { name: "Bypass Stereo" }).click();
  await expect
    .poll(async () => (await settledLevel(page)) / centred, {
      timeout: 15_000,
    })
    .toBeGreaterThan(0.9);
});

test("an export with Stereo panned hard left has a silent right channel", async ({
  page,
}) => {
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await page.goto("/");
  test.skip(
    !(await page.evaluate(
      async () =>
        (
          await AudioEncoder.isConfigSupported({
            codec: "mp4a.40.2",
            sampleRate: 48_000,
            numberOfChannels: 2,
            bitrate: 192_000,
          })
        ).supported,
    )),
    "This browser has no AAC encoder.",
  );
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await addTone(page, 3);
  await page.locator(".source-span").click();
  await addStereo(page);
  await panHardLeft(page);

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Width").fill("320");
  await dialog.getByLabel("Height").fill("180");
  const download = page.waitForEvent("download", { timeout: 120_000 });
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const mp4 = await readFile(await (await download).path());

  // The offline render pans exactly as the preview: the tone, peak
  // 10000 / 32767 at unity in each channel when centred, plays at √2 times
  // that on the left and not at all on the right.
  const [left, right] = await page.evaluate(
    async (bytes) => {
      const context = new OfflineAudioContext(2, 1, 48_000);
      const audio = await context.decodeAudioData(new Uint8Array(bytes).buffer);
      const peaks = [0, 0];
      for (let channel = 0; channel < 2; channel++) {
        const samples = audio.getChannelData(
          Math.min(channel, audio.numberOfChannels - 1),
        );
        // Skips the encoder's priming and the fades at the ends.
        for (
          let index = Math.round(audio.length * 0.25);
          index < Math.round(audio.length * 0.75);
          index++
        ) {
          peaks[channel] = Math.max(peaks[channel], Math.abs(samples[index]));
        }
      }
      return peaks;
    },
    [...mp4],
  );
  expect(right).toBeLessThan(0.01);
  expect(Math.abs(left - (10_000 / 32_767) * Math.SQRT2)).toBeLessThan(0.04);
});
