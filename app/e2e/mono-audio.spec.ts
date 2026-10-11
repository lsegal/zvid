import { expect, type Page, test } from "@playwright/test";

// Stays in Playwright: it measures the real mixer playing an imported clip.
// chain-worklet.component.test.tsx covers the worklet matching export.
//
// Mono changes what the preview hears.
test.use({ viewport: { width: 1600, height: 1200 } });
test.describe.configure({ timeout: 90_000 });

// Records the analysers the preview's mixer makes, which measure the mix
// after every effect. An analyser hears a stereo mix as (L+R)/2.
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

// The mix's RMS level over the analyser's latest window.
function mixLevel(page: Page) {
  return page.evaluate(() => {
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
  });
}

// The steadiest level over a few reads, so a read between buffers doesn't
// count.
async function settledLevel(page: Page) {
  let level = 0;
  for (let read = 0; read < 6; read += 1) {
    level = Math.max(level, await mixLevel(page));
    await page.waitForTimeout(50);
  }
  return level;
}

// A 16-bit stereo WAV with a 440 Hz tone on the left and silence on the
// right, so each Source setting sounds different.
function leftToneWav(seconds: number) {
  const sampleRate = 8000;
  const frames = Math.round(seconds * sampleRate);
  const wav = Buffer.alloc(44 + frames * 4);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 4, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(frames * 4, 40);
  for (let index = 0; index < frames; index++) {
    const sample = Math.sin((2 * Math.PI * 440 * index) / sampleRate);
    wav.writeInt16LE(Math.round(sample * 10_000), 44 + index * 4);
  }
  return wav.toString("base64");
}

async function addSourceAudio(page: Page, base64: string) {
  const dataTransfer = await page.evaluateHandle((data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([bytes], "left-tone.wav", { type: "audio/wav" }),
    );
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

// The level while playing from the session start, once it settles.
async function playingLevel(page: Page) {
  await page.getByRole("button", { name: "Jump to timeline start" }).click();
  const play = page.getByRole("button", { name: "Play timeline" });
  if (await play.isVisible()) {
    await play.click();
  }
  // Long enough for the chain's ramps and the analyser's window.
  await page.waitForTimeout(400);
  return settledLevel(page);
}

test("Mono's Source and Amount move the preview's level", async ({ page }) => {
  await probeAnalysers(page);
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await addSourceAudio(page, leftToneWav(30));

  await page.locator(".source-span").click();
  await page
    .getByRole("button", { name: "Add device to this clip" })
    .first()
    .click();
  await page
    .getByRole("menu")
    .getByRole("menuitem", { name: "Volume & Stereo" })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^Mono/ }).click();
  const mono = page.locator(
    '.fx-chain .fx-device-panel[data-fx-group="clip"][aria-label="Mono"]',
  );
  await expect(mono).toHaveCount(1);
  const source = mono.getByRole("group", { name: "Source" });

  // The tone is about 0.22 RMS on its own side. Sum puts half of it on
  // both sides, which the analyser hears as 0.11; Left puts all of it on
  // both, 0.22; Right puts the silent side on both.
  await expect
    .poll(() => playingLevel(page), { timeout: 30_000 })
    .toBeGreaterThan(0.08);
  const sum = await playingLevel(page);
  expect(sum).toBeLessThan(0.14);

  await source.getByRole("button", { name: "Left" }).click();
  await expect
    .poll(() => playingLevel(page), { timeout: 30_000 })
    .toBeGreaterThan(sum * 1.6);

  await source.getByRole("button", { name: "Right" }).click();
  await expect
    .poll(() => playingLevel(page), { timeout: 30_000 })
    .toBeLessThan(0.01);

  // At 0 % the original stereo passes: the analyser hears the tone's half
  // again.
  await mono.getByRole("slider", { name: "Amount" }).press("Home");
  await expect(mono.getByRole("slider", { name: "Amount" })).toHaveAttribute(
    "aria-valuetext",
    "0%",
  );
  await expect
    .poll(
      async () => {
        const level = await playingLevel(page);
        return level > sum * 0.8 && level < sum * 1.25;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
});
