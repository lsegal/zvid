import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// The Reverse audio effect: it is added from a clip's Audio add menu, but
// not a track's, with no parameters, and plays the clip's audio backwards:
// a clip whose first half is a low tone and second half a high one starts
// on the high tone in the preview, and an export's loud first half and
// quiet second half come out the other way round.

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

// The loudest frequency the mix plays now, in Hz, or 0 while it is silent.
function dominantFrequency(page: Page) {
  return page.evaluate(() => {
    const probe = window as unknown as { analysers: AnalyserNode[] };
    const analyser = probe.analysers.at(-1);
    if (!analyser) {
      return 0;
    }
    const bins = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(bins);
    let loudest = 1;
    for (let bin = 2; bin < bins.length; bin++) {
      if (bins[bin] > bins[loudest]) {
        loudest = bin;
      }
    }
    return bins[loudest] > -70
      ? (loudest * analyser.context.sampleRate) / analyser.fftSize
      : 0;
  });
}

// A 16-bit mono WAV whose first half plays `first` and second half
// `second`: a frequency in Hz and a peak out of 32767 each.
function twoPartWav(
  seconds: number,
  first: { hz: number; peak: number },
  second: { hz: number; peak: number },
) {
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
    const { hz, peak } = index < frames / 2 ? first : second;
    const sample = Math.sin((2 * Math.PI * hz * index) / sampleRate);
    wav.writeInt16LE(Math.round(sample * peak), 44 + index * 2);
  }
  return wav.toString("base64");
}

async function addWav(page: Page, base64: string) {
  const dataTransfer = await page.evaluateHandle((wav) => {
    const bytes = Uint8Array.from(atob(wav), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "tone.wav", { type: "audio/wav" }));
    return transfer;
  }, base64);
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

// Adds Reverse to the selected clip from its add menu, which for a clip
// with only sound lists the audio effects alone.
async function addReverse(page: Page) {
  await page
    .getByRole("button", { name: "Add device to this clip" })
    .first()
    .click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("group", { name: "Video" })).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "Utility" }).press("ArrowRight");
  await page.getByRole("menuitem", { name: /^Reverse/ }).click();
  const reverse = page.locator(`${clipDevices}[aria-label="Reverse"]`);
  await expect(reverse).toHaveCount(1);
  return reverse;
}

async function playFromStart(page: Page) {
  const pause = page.getByRole("button", { name: "Pause playback" });
  if (await pause.isVisible()) {
    await pause.click();
  }
  await page.getByRole("button", { name: "Jump to timeline start" }).click();
  await page.getByRole("button", { name: "Play timeline" }).click();
}

// Waits for the preview to play a tone within 15% of `hz`.
async function expectTone(page: Page, hz: number) {
  await expect
    .poll(
      async () => {
        const frequency = await dominantFrequency(page);
        return Math.abs(frequency - hz) < hz * 0.15;
      },
      { timeout: 6_000 },
    )
    .toBe(true);
}

test("a video clip lists Reverse in its add menu's Audio group, and a track doesn't", async ({
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

  const trackAdd = page
    .getByRole("button", { name: "Add device to this track" })
    .first();
  await trackAdd.click();
  const trackMenu = page.getByRole("menu");
  await expect(
    trackMenu.getByRole("menuitem", { name: "Volume & Stereo" }),
  ).toBeVisible();
  await expect(
    trackMenu.getByRole("menuitem", { name: "Utility" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(trackMenu).toHaveCount(0);

  await page
    .getByRole("button", { name: "Add device to this clip" })
    .first()
    .click();
  const audio = page.getByRole("menu").getByRole("group", { name: "Audio" });
  await audio.getByRole("menuitem", { name: "Utility" }).press("ArrowRight");
  await page.getByRole("menuitem", { name: /^Reverse/ }).click();
  await expect(
    page.locator(`${clipDevices}[aria-label="Reverse"]`),
  ).toHaveCount(1);
});

test("Reverse adds with no controls and plays the preview backwards", async ({
  page,
}) => {
  await probeAnalysers(page);
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  // Long enough halves to keep each check within one.
  await addWav(
    page,
    twoPartWav(24, { hz: 300, peak: 10_000 }, { hz: 1500, peak: 10_000 }),
  );
  await page.locator(".source-span").click();

  // Forwards, it starts on the low tone.
  await playFromStart(page);
  await expectTone(page, 300);

  const reverse = await addReverse(page);
  await expect(
    reverse.getByRole("img", { name: "Audio effect" }),
  ).toBeVisible();
  await expect(
    reverse.getByRole("button", { name: /Turn Animation/ }),
  ).toHaveCount(0);
  await expect(reverse.getByRole("slider")).toHaveCount(0);

  // Reversed, it starts on the high tone.
  await playFromStart(page);
  await expectTone(page, 1500);

  // Bypassing it plays forwards again.
  await reverse.getByRole("button", { name: "Bypass Reverse" }).click();
  await playFromStart(page);
  await expectTone(page, 300);
});

test("an export with Reverse plays the clip's audio backwards", async ({
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
  // Loud first, quiet second.
  await addWav(
    page,
    twoPartWav(4, { hz: 440, peak: 10_000 }, { hz: 440, peak: 2_000 }),
  );
  await page.locator(".source-span").click();
  await addReverse(page);

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Width").fill("320");
  await dialog.getByLabel("Height").fill("180");
  const download = page.waitForEvent("download", { timeout: 120_000 });
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const mp4 = await readFile(await (await download).path());

  // The offline render reads the clip's window backwards, as the unit
  // tests' offline render does: the quiet half first, then the loud one.
  const [first, second] = await page.evaluate(
    async (bytes) => {
      const context = new OfflineAudioContext(2, 1, 48_000);
      const audio = await context.decodeAudioData(new Uint8Array(bytes).buffer);
      const samples = audio.getChannelData(0);
      const peak = (from: number, to: number) => {
        let max = 0;
        for (
          let index = Math.round(audio.length * from);
          index < Math.round(audio.length * to);
          index++
        ) {
          max = Math.max(max, Math.abs(samples[index]));
        }
        return max;
      };
      // Skips the encoder's priming, the fades at the ends and the switch
      // in the middle.
      return [peak(0.1, 0.4), peak(0.6, 0.9)];
    },
    [...mp4],
  );
  expect(Math.abs(first - 2_000 / 32_767)).toBeLessThan(0.02);
  expect(Math.abs(second - 10_000 / 32_767)).toBeLessThan(0.04);
});
