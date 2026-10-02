import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

// The High Cut audio effect: added from a clip's add menu, in its Audio
// group, with its controls at their defaults, and filtering what the
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

async function playFromStart(page: Page) {
  for (let bar = 0; bar < 2; bar += 1) {
    await page.getByRole("button", { name: "Jump back one bar" }).click();
  }
  await page.getByRole("button", { name: "Play timeline" }).click();
}

const highCutDevice = (page: Page) =>
  page.locator(
    '.fx-chain .fx-device-panel[data-fx-group="clip"][aria-label="High Cut"]',
  );

// Types `value` into a knob's readout.
async function setKnob(page: Page, label: string, value: string) {
  const device = highCutDevice(page);
  await device
    .getByRole("button", { name: new RegExp(`^${label}: `) })
    .dblclick();
  const input = device.getByRole("textbox", { name: `${label} value` });
  await input.fill(value);
  await input.press("Enter");
}

test("High Cut is added from a clip's Audio menu with its defaults and filters the mix", async ({
  page,
}) => {
  await probeAnalysers(page);
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  // Long enough to keep playing through every check.
  await addTone(page, 30);

  await page.locator(".source-span").click();
  await page
    .getByRole("button", { name: "Add device to this clip" })
    .first()
    .click();
  // An audio clip is offered only audio effects, so its menu needs no
  // Audio heading.
  await page
    .getByRole("menu")
    .getByRole("menuitem", { name: "EQ & Filter" })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^High Cut/ }).click();

  const device = highCutDevice(page);
  await expect(device).toHaveCount(1);
  await expect(device.getByRole("img", { name: "Audio effect" })).toBeVisible();
  await expect(
    device.getByRole("button", { name: /Turn Animation/ }),
  ).toHaveCount(0);
  for (const [label, text] of [
    ["Frequency", "8.00 kHz"],
    ["Resonance", "0.71"],
  ]) {
    await expect(device.getByRole("slider", { name: label })).toHaveAttribute(
      "aria-valuetext",
      text,
    );
  }
  const slopes = device.getByRole("group", { name: "Slope" });
  for (const slope of ["12 dB/oct", "24 dB/oct"]) {
    await expect(slopes.getByRole("button", { name: slope })).toHaveAttribute(
      "aria-pressed",
      String(slope === "12 dB/oct"),
    );
  }

  // The 440 Hz tone is far below the default 8 kHz cutoff, so it plays at
  // about its full level.
  await playFromStart(page);
  let open = 0;
  await expect
    .poll(
      async () => {
        open = await settledLevel(page);
        return open;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0.02);

  // A 200 Hz cutoff is over an octave below the tone, which drops by about
  // 13 dB at 12 dB/oct.
  await setKnob(page, "Frequency", "200");
  await expect(
    device.getByRole("slider", { name: "Frequency" }),
  ).toHaveAttribute("aria-valuetext", "200 Hz");
  let filtered = 0;
  await expect
    .poll(
      async () => {
        filtered = await settledLevel(page);
        return filtered;
      },
      { timeout: 15_000 },
    )
    .toBeLessThan(open * 0.35);

  // 24 dB/oct cuts it further still.
  await slopes.getByRole("button", { name: "24 dB/oct" }).click();
  await expect
    .poll(() => settledLevel(page), { timeout: 15_000 })
    .toBeLessThan(filtered * 0.5);

  // Bypassing it brings the tone back to its full level.
  await device.getByRole("button", { name: "Bypass High Cut" }).click();
  await expect
    .poll(() => settledLevel(page), { timeout: 15_000 })
    .toBeGreaterThan(open * 0.8);
});

test("a video clip's add menu lists High Cut in its Audio group", async ({
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
      name: "EQ & Filter",
    }),
  ).toHaveCount(0);
  await menu
    .getByRole("group", { name: "Audio" })
    .getByRole("menuitem", { name: "EQ & Filter" })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^High Cut/ }).click();
  await expect(highCutDevice(page)).toHaveCount(1);
});

test("the export's offline render runs High Cut exactly as the chain does", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    // Variables, so the type checker doesn't resolve the dev server paths.
    const offlinePath = "/src/audio-mix/offline.ts";
    const chainPath = "/src/audio-mix/chain.ts";
    const processorsPath = "/src/audio-mix/processors.ts";
    const highCutPath = "/src/fx/effects/high-cut/high-cut.ts";
    const { renderAudioMixOffline } = await import(offlinePath);
    const { AudioChain, BLOCK_FRAMES } = await import(chainPath);
    const { AUDIO_PROCESSORS } = await import(processorsPath);
    const { highCutResponseDb } = await import(highCutPath);

    const sampleRate = 48_000;
    const length = sampleRate * 2;
    // A 440 Hz tone at 0.3 as a 16-bit WAV, below the limiter's knee
    // whatever the filter does to it.
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
      const sample = 0.3 * Math.sin((2 * Math.PI * 440 * index) / sampleRate);
      wav.setInt16(44 + index * 2, Math.round(sample * 32767), true);
    }
    const url = URL.createObjectURL(new Blob([wav.buffer]));

    const stage = {
      id: "high-cut",
      effectName: "High Cut",
      enabled: true,
      numbers: { Frequency: 300, Resonance: 2 },
      switches: { Slope: "24 dB/oct" },
    };
    const signature = { numerator: 4, denominator: 4 };
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
          stages: [stage],
        },
      ],
      buses: [{ id: "bus", stages: [] }],
      master: [],
      masterAmplitude: 1,
      fromSourceTracks: true,
      bpm: 120,
      signature,
    };
    const [exported] = await renderAudioMixOffline(
      mix,
      [{ id: "tone", previewUrl: url }],
      { sampleRate, numberOfChannels: 1, startSeconds: 0, length },
    );

    // The same tone, decoded the same way, through a lone chain.
    const context = new OfflineAudioContext(1, 1, sampleRate);
    const decoded = await context.decodeAudioData(
      await (await fetch(url)).arrayBuffer(),
    );
    const input = decoded.getChannelData(0);
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

    const rms = (samples: Float32Array) => {
      let total = 0;
      for (let index = length / 2; index < length; index++) {
        total += samples[index] * samples[index];
      }
      return Math.sqrt(total / (length / 2));
    };
    let difference = 0;
    for (let index = 0; index < length; index++) {
      difference = Math.max(
        difference,
        Math.abs(exported[index] - direct[index]),
      );
    }
    return {
      difference,
      gainDb: 20 * Math.log10(rms(exported) / rms(input)),
      expectedDb: highCutResponseDb(
        { frequency: 300, resonance: 2, slope: "24 dB/oct" },
        440,
        sampleRate,
      ),
    };
  });
  expect(result.difference).toBeLessThanOrEqual(1e-5);
  expect(Math.abs(result.gainDb - result.expectedDb)).toBeLessThan(0.2);
});
