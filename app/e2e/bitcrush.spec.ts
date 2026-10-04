import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

// The Bitcrush audio effect: added from a clip's add menu, in its Audio
// group, with its controls at their defaults, and crushing what the
// preview mix plays.
test.use({ viewport: { width: 1600, height: 1200 } });
test.describe.configure({ timeout: 90_000 });

// Records the analysers the preview's mixer makes, which measure the mix
// after every clip's effects.
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

// The mix's RMS level over the analyser's latest window, and the share of
// its spectrum's power above 1 kHz, where the 440 Hz tone has none of its
// own and only the harmonics and images the crush adds land.
function mixReading(page: Page) {
  return page.evaluate(() => {
    const probe = window as unknown as { analysers: AnalyserNode[] };
    const analyser = probe.analysers.at(-1);
    if (!analyser) {
      return { level: 0, harmonics: 0 };
    }
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    let total = 0;
    for (const sample of samples) {
      total += sample * sample;
    }
    const bins = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(bins);
    const binHz = analyser.context.sampleRate / analyser.fftSize;
    let all = 0;
    let high = 0;
    bins.forEach((db, bin) => {
      const power = 10 ** (db / 10);
      all += power;
      if (bin * binHz > 1000) {
        high += power;
      }
    });
    return {
      level: Math.sqrt(total / samples.length),
      harmonics: all > 0 ? high / all : 0,
    };
  });
}

// The steadiest reading over a few reads, so a read between buffers
// doesn't count.
async function settledReading(page: Page) {
  let best = { level: 0, harmonics: 0 };
  for (let read = 0; read < 6; read += 1) {
    const reading = await mixReading(page);
    if (reading.level > best.level) {
      best = reading;
    }
    await page.waitForTimeout(50);
  }
  return best;
}

// A 440 Hz tone as a 16-bit mono WAV.
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
    wav.writeInt16LE(Math.round(sample * 3000), 44 + index * 2);
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

async function playFromStart(page: Page) {
  for (let bar = 0; bar < 2; bar += 1) {
    await page.getByRole("button", { name: "Jump back one bar" }).click();
  }
  await page.getByRole("button", { name: "Play timeline" }).click();
}

const bitcrushDevice = (page: Page) =>
  page.locator(
    '.fx-chain .fx-device-panel[data-fx-group="clip"][aria-label="Bitcrush"]',
  );

// Types `value` into a knob's readout.
async function setKnob(page: Page, label: string, value: string) {
  const device = bitcrushDevice(page);
  await device
    .getByRole("button", { name: new RegExp(`^${label}: `) })
    .dblclick();
  const input = device.getByRole("textbox", { name: `${label} value` });
  await input.fill(value);
  await input.press("Enter");
}

test("Bitcrush is added from a clip's Audio menu with its defaults and crushes the mix", async ({
  page,
}) => {
  await probeAnalysers(page);
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  // As long as the test's timeout, so it keeps playing through every check
  // however slowly a busy runner gets through them.
  await addTone(page, 90);

  await page.locator(".source-span").click();
  await page
    .getByRole("button", { name: "Add device to this clip" })
    .first()
    .click();
  // An audio clip is offered only audio effects, so its menu needs no
  // Audio heading.
  await page
    .getByRole("menu")
    .getByRole("menuitem", { name: "Distortion" })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^Bitcrush/ }).click();

  const device = bitcrushDevice(page);
  await expect(device).toHaveCount(1);
  await expect(device.getByRole("img", { name: "Audio effect" })).toBeVisible();
  await expect(
    device.getByRole("button", { name: /Turn Animation/ }),
  ).toHaveCount(0);
  for (const [label, text] of [
    ["Bits", "8 bits"],
    ["Downsample", "1×"],
    ["Mix", "100%"],
  ]) {
    await expect(
      device.getByRole("slider", { name: label, exact: true }),
    ).toHaveAttribute("aria-valuetext", text);
  }

  await playFromStart(page);
  await expect
    .poll(async () => (await settledReading(page)).level, { timeout: 15_000 })
    .toBeGreaterThan(0.01);
  // Read the clean tone again once it is playing: the reading that first
  // heard it can hold the tone's onset, whose click spreads power above
  // 1 kHz and would set the harmonics the crush must beat out of reach.
  const clean = await settledReading(page);
  expect(clean.level).toBeGreaterThan(0.01);

  // 1 bit turns the quiet tone into a full-scale square wave: far louder,
  // with odd harmonics carrying much of its power.
  await setKnob(page, "Bits", "1");
  await expect(
    device.getByRole("slider", { name: "Bits", exact: true }),
  ).toHaveAttribute("aria-valuetext", "1 bit");
  await expect
    .poll(async () => (await settledReading(page)).harmonics, {
      timeout: 15_000,
    })
    .toBeGreaterThan(Math.max(0.05, clean.harmonics * 5));
  expect((await settledReading(page)).level).toBeGreaterThan(clean.level * 4);

  // At full depth, holding each sample for 64 frames images the tone
  // above 1 kHz.
  await setKnob(page, "Bits", "16");
  await setKnob(page, "Downsample", "64");
  await expect(
    device.getByRole("slider", { name: "Downsample", exact: true }),
  ).toHaveAttribute("aria-valuetext", "64×");
  await expect
    .poll(async () => (await settledReading(page)).harmonics, {
      timeout: 15_000,
    })
    .toBeGreaterThan(Math.max(0.05, clean.harmonics * 5));

  // Bypassing it brings the clean tone back.
  await device.getByRole("button", { name: "Bypass Bitcrush" }).click();
  await expect
    .poll(async () => (await settledReading(page)).harmonics, {
      timeout: 15_000,
    })
    .toBeLessThan(0.05);
});

test("a video clip's add menu lists Bitcrush in its Audio group", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  const base64 = (await readFile(VIDEO)).toString("base64");
  const dataTransfer = await page.evaluateHandle((data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([bytes], "test-pattern.mp4", { type: "video/mp4" }),
    );
    return transfer;
  }, base64);
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(
      '[data-source-track-drop-target="new-track"]',
      type,
      { dataTransfer },
    );
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });

  await page.locator(".source-span").click();
  await page
    .getByRole("button", { name: "Add device to this clip" })
    .first()
    .click();
  const menu = page.getByRole("menu");
  await expect(
    menu.getByRole("group", { name: "Video" }).getByRole("menuitem", {
      name: "Distortion",
    }),
  ).toHaveCount(0);
  await menu
    .getByRole("group", { name: "Audio" })
    .getByRole("menuitem", { name: "Distortion" })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^Bitcrush/ }).click();
  await expect(bitcrushDevice(page)).toHaveCount(1);
});

// Renders a 440 Hz tone at 0.2 through Bitcrush with `numbers`, both as an
// export does and through a lone chain fed the clip as export reads it.
function renderBoth(page: Page, numbers: Record<string, number>) {
  return page.evaluate(
    async ({ numbers }) => {
      // Variables, so the type checker doesn't resolve the dev server paths.
      const offlinePath = "/src/audio-mix/offline.ts";
      const chainPath = "/src/audio-mix/chain.ts";
      const processorsPath = "/src/audio-mix/processors.ts";
      const { renderAudioMixOffline } = await import(offlinePath);
      const { AudioChain, BLOCK_FRAMES } = await import(chainPath);
      const { AUDIO_PROCESSORS } = await import(processorsPath);

      const sampleRate = 48_000;
      const length = sampleRate * 2;
      const wav = new DataView(new ArrayBuffer(44 + length * 2));
      const ascii = (offset: number, text: string) => {
        for (let index = 0; index < text.length; index++) {
          wav.setUint8(offset + index, text.charCodeAt(index));
        }
      };
      ascii(0, "RIFF");
      wav.setUint32(4, wav.byteLength - 8, true);
      ascii(8, "WAVEfmt ");
      wav.setUint32(16, 16, true);
      wav.setUint16(20, 1, true);
      wav.setUint16(22, 1, true);
      wav.setUint32(24, sampleRate, true);
      wav.setUint32(28, sampleRate * 2, true);
      wav.setUint16(32, 2, true);
      wav.setUint16(34, 16, true);
      ascii(36, "data");
      wav.setUint32(40, length * 2, true);
      for (let index = 0; index < length; index++) {
        const sample = 0.2 * Math.sin((2 * Math.PI * 440 * index) / sampleRate);
        wav.setInt16(44 + index * 2, Math.round(sample * 32767), true);
      }
      const url = URL.createObjectURL(new Blob([wav.buffer]));

      const stage = {
        id: "bitcrush",
        effectName: "Bitcrush",
        enabled: true,
        numbers,
        switches: {},
      };
      const signature = { numerator: 4, denominator: 4 };
      const exportWith = async (stages: (typeof stage)[]) => {
        const mix = {
          clips: [
            {
              id: "clip",
              mediaId: "tone",
              startSeconds: 0,
              durationSeconds: 2,
              sourceOffsetSeconds: 0,
              sourceWindowStartSeconds: 0,
              sourceWindowEndSeconds: 2,
              effects: [],
              amplitude: 1,
              hasGain: true,
              busId: "bus",
              stages,
            },
          ],
          buses: [{ id: "bus", stages: [] }],
          master: [],
          masterAmplitude: 1,
          fromSourceTracks: true,
          bpm: 120,
          signature,
        };
        const [rendered] = await renderAudioMixOffline(
          mix,
          [{ id: "tone", previewUrl: url }],
          { sampleRate, numberOfChannels: 1, startSeconds: 0, length },
        );
        return rendered as Float32Array;
      };
      const exported = await exportWith([stage]);

      // The clip as export reads it, through a lone chain. Export's reading
      // differs from the WAV's samples by rounding error, which the crush
      // would turn into a whole level where a sample sits on a step, so
      // both get the same input.
      const input = await exportWith([]);
      const chain = new AudioChain(AUDIO_PROCESSORS, sampleRate, 1);
      chain.configure(
        { stages: [stage], inputGain: 1, delayFrames: 0 },
        { bpm: 120, signature },
      );
      const direct = new Float32Array(length);
      const block = [new Float32Array(BLOCK_FRAMES)];
      for (let start = 0; start < length; start += BLOCK_FRAMES) {
        const frames = Math.min(BLOCK_FRAMES, length - start);
        const source = new Float32Array(BLOCK_FRAMES);
        source.set(input.subarray(start, start + frames));
        chain.process([source], block, frames, start / sampleRate);
        direct.set(block[0].subarray(0, frames), start);
      }

      let difference = 0;
      let change = 0;
      for (let index = 0; index < length; index++) {
        difference = Math.max(
          difference,
          Math.abs(exported[index] - direct[index]),
        );
        change = Math.max(change, Math.abs(exported[index] - input[index]));
      }
      return { difference, change };
    },
    { numbers },
  );
}

test("the export's offline render runs Bitcrush exactly as the chain does", async ({
  page,
}) => {
  await page.goto("/");
  // Both stay below the export limiter's knee.
  for (const numbers of [
    { Bits: 3, Downsample: 6, Mix: 0.8 },
    { Bits: 1, Downsample: 1, Mix: 0.5 },
  ]) {
    const result = await renderBoth(page, numbers);
    expect(result.difference).toBeLessThanOrEqual(1e-5);
    // And it does crush the tone.
    expect(result.change).toBeGreaterThan(0.05);
  }
});
